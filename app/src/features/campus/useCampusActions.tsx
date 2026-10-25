import * as React from 'react';

import type { CommentNode } from '@/components/ui/CommentThread';
import { useListPagination } from '@/components/ui/ListScreen';
import type { CommentReplyContext } from '@/components/ui/CommentComposer';
import { useSession } from '@/features/auth/session';
import { classifyAuthFailure, isSessionInvalid } from '@/features/auth/authFailure';
import { useI18n } from '@/i18n';
import { levelNameKey } from '@/features/me/profile';
import {
  toggleLike,
  getPostComments,
  createComment,
  getPostDetail,
} from '../../../../shared/api/posts';
import {
  toggleConfessionLike,
  getConfessionComments,
  createConfessionComment,
  deleteConfessionComment,
} from '../../../../shared/api/confessions';
import { formatPostTime } from '../../../../shared/utils/formatTime';
import { useCampusReport, type CampusReportReason, type CampusReportState } from './useCampusReport';

/**
 * 校园内容（树洞 / 万能墙）的**互动与评论状态**（不含任何 JSX）
 *
 * ⚠️ 本文件从"返回一段 JSX 的 body"改为**返回数据与动作**：视觉层（PostRow / Detail）
 * 现在由页面组合。原因有两个：
 *   1. 详情要粘性底栏 + 顶部提示两种位置，JSX 塞在 hook 里无法同时满足；
 *   2. 评论时间必须在**投影层**格式化（旧实现把后端 ISO 字符串直接显示到界面）。
 */

export type CampusInteractionPost = {
  id: number;
  user_liked?: boolean;
  liked?: boolean;
  like_count?: number;
  comment_count?: number;
};
export type CampusKind = 'confession' | 'wall';

/** 点赞/评论失败的可感知状态（页面据此渲染 InlineNotice / 登录入口） */
export type CampusNotice = 'login' | 'denied' | 'likeFailed' | 'sendFailed' | null;

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function comment(
  value: unknown,
  kind: CampusKind,
  parentId: number | null,
  t: (key: ReturnType<typeof levelNameKey>) => string,
  locale: 'zh' | 'en'
): CommentNode {
  if (!value || typeof value !== 'object') throw new Error('Invalid comment');
  const row = value as {
    id: number;
    content: string;
    author?: { nickname?: string; username?: string; avatar?: string; level?: number; badge?: string };
    created_at?: string;
    viewer_is_mine?: boolean;
  };
  if (!Number.isSafeInteger(row.id) || row.id <= 0 || typeof row.content !== 'string') {
    throw new Error('Invalid comment');
  }
  const level =
    typeof row.author?.level === 'number' &&
    Number.isSafeInteger(row.author.level) &&
    row.author.level >= 1 &&
    row.author.level <= 6
      ? row.author.level
      : null;
  return {
    id: String(row.id),
    parentId: parentId === null ? null : String(parentId),
    depth: parentId === null ? 0 : 1,
    content: row.content,
    // 万能墙专属：viewer_is_mine 只回答「是不是你自己发的」，不泄露任何身份（树洞契约不同，恒 undefined）
    canDelete: kind === 'wall' && row.viewer_is_mine === true ? true : undefined,
    // 投影层就格式化：界面不再出现 `2026-10-15T10:42:00.000Z` 这种后端原文
    createdAtLabel: typeof row.created_at === 'string' ? formatPostTime(row.created_at, { locale }) : '',
    author:
      kind === 'wall'
        ? { kind: 'anonymous' }
        : {
            kind: 'named',
            name: row.author?.nickname || row.author?.username || '—',
            avatarUri:
              typeof row.author?.avatar === 'string' && row.author.avatar.trim()
                ? row.author.avatar
                : undefined,
            levelLabel: level === null ? undefined : t(levelNameKey(level)),
          },
  };
}

/** 把后端两级评论投影成扁平的节点表（纯逻辑，未知身份在万能墙被丢弃） */
function comments(
  value: unknown,
  kind: CampusKind,
  t: (key: ReturnType<typeof levelNameKey>) => string,
  locale: 'zh' | 'en'
): CommentNode[] {
  if (!Array.isArray(value)) throw new Error('Invalid comments');
  const result: CommentNode[] = [];
  for (const row of value) {
    const root = comment(row, kind, null, t, locale);
    result.push(root);
    if (row.replies != null && !Array.isArray(row.replies)) throw new Error('Invalid replies');
    for (const reply of row.replies ?? []) result.push(comment(reply, kind, Number(root.id), t, locale));
  }
  return Array.from(new Map(result.map((node) => [node.id, node])).values());
}

/** 列表与详情共享同一个已鉴权点赞动作；⛔ 列表行不因此去加载评论 */
export function useCampusLike(post: CampusInteractionPost | null, kind: CampusKind) {
  const session = useSession();
  const [liked, setLiked] = React.useState(false),
    [likeCount, setLikeCount] = React.useState<number | null>(null);
  const [commentCount, setCommentCount] = React.useState<number | null>(null);
  const [notice, setNotice] = React.useState<CampusNotice>(null);
  const epoch = React.useRef(0),
    locked = React.useRef(false);
  React.useEffect(() => {
    ++epoch.current;
    locked.current = false;
    setNotice(null);
    setLiked(kind === 'wall' ? post?.liked === true : post?.user_liked === true);
    setLikeCount(count(post?.like_count));
    setCommentCount(count(post?.comment_count));
    return () => {
      ++epoch.current;
    };
  }, [post, kind]);
  const allowed = () => {
    if (session.isSignedIn) return true;
    setNotice('login');
    return false;
  };
  const fail = async (error: unknown, request: number) => {
    const auth = classifyAuthFailure(error);
    if (request !== epoch.current) return;
    if (isSessionInvalid(auth)) await session.handleAuthFailure(error);
    if (request === epoch.current) {
      setNotice(isSessionInvalid(auth) ? 'login' : auth === 'sanctioned' ? 'denied' : 'likeFailed');
    }
  };
  const like = async () => {
    if (!post || locked.current || !allowed()) return;
    locked.current = true;
    const request = epoch.current;
    setNotice(null);
    try {
      const data =
        kind === 'wall' ? await toggleConfessionLike(post.id) : await toggleLike(post.id);
      if (request !== epoch.current) return;
      const target = kind === 'wall' ? data?.confession_id : data?.post_id;
      if (target !== post.id || typeof data?.liked !== 'boolean') {
        throw new Error('Invalid like response');
      }
      setLiked(data.liked);
      // 树洞响应不带计数：保持上一次的服务端计数，⛔ 不发明新数字
      if (count(data.like_count) !== null) setLikeCount(data.like_count);
      else if (kind === 'confession') {
        setLikeCount(null);
        try {
          const fresh = await getPostDetail(post.id);
          if (request === epoch.current && fresh?.id === post.id) setLikeCount(count(fresh.like_count));
        } catch {
          /* 计数未知就保持占位，点赞态仍以成功响应为准 */
        }
      }
    } catch (error) {
      await fail(error, request);
    } finally {
      if (request === epoch.current) locked.current = false;
    }
  };
  return {
    liked,
    likeCount,
    commentCount,
    notice,
    onToggleLike: () => void like(),
    incrementCommentCount: () =>
      setCommentCount((current) => (current === null ? null : current + 1)),
  };
}

export type CampusActions = {
  interactions: { liked: boolean; likeCount: number | null; commentCount: number | null };
  onToggleLike: () => void;
  likeNotice: CampusNotice;
  comments: {
    nodes: readonly CommentNode[];
    loading: boolean;
    error: boolean;
    retry: () => void;
    onReply: (id: string) => void;
    /** 万能墙：删除自己的评论（乐观移除，失败回滚并置 deleteFailed） */
    deleteComment: (id: string) => void;
    deleteFailed: boolean;
  };
  reply: CommentNode | null;
  cancelReply: () => void;
  replyContext: CommentReplyContext | undefined;
  draft: string;
  setDraft: (next: string) => void;
  sending: boolean;
  send: () => void;
  composeNotice: CampusNotice;
  report: {
    state: CampusReportState;
    submit: (reason: CampusReportReason, detail: string) => Promise<void>;
  };
};

/**
 * 详情的互动 + 评论读写。**不产生任何 JSX**：
 * 页面把 `likeNotice` 渲染在动作区、把 `composeNotice` 渲染在粘性底栏上方。
 */
export function useCampusActions(
  post: CampusInteractionPost | null,
  kind: CampusKind
): CampusActions {
  const { t, locale } = useI18n();
  const session = useSession();
  const report = useCampusReport(
    post ? { id: post.id, kind } : null,
    session.isSignedIn,
    session.handleAuthFailure
  );
  const like = useCampusLike(post, kind);
  const [nodes, setNodes] = React.useState<CommentNode[]>([]),
    [draft, setDraft] = React.useState('');
  const [reply, setReply] = React.useState<CommentNode | null>(null),
    [sending, setSending] = React.useState(false),
    [commentDeleteFailed, setCommentDeleteFailed] = React.useState(false);
  const [notice, setNotice] = React.useState<CampusNotice>(null);
  const { pagination, dispatch } = useListPagination({ initial: { hasMore: false } });
  const epoch = React.useRef(0),
    locks = React.useRef({ send: false, read: false });
  const draftRef = React.useRef(draft);
  draftRef.current = draft;
  const replyRef = React.useRef(reply);
  replyRef.current = reply;

  const loadComments = React.useCallback(async () => {
    if (!post || locks.current.read || locks.current.send) return;
    locks.current.read = true;
    const request = epoch.current;
    dispatch({ type: 'append:start' });
    try {
      const data = kind === 'wall' ? await getConfessionComments(post.id) : await getPostComments(post.id);
      if (request !== epoch.current) return;
      setNodes(comments(data, kind, t, locale));
      dispatch({ type: 'append:success', hasMore: false });
    } catch {
      if (request === epoch.current) dispatch({ type: 'append:failure', error: { kind: 'unknown' } });
    } finally {
      if (request === epoch.current) locks.current.read = false;
    }
  }, [post, kind, dispatch, t, locale]);

  /** 万能墙：删自己的评论——乐观移除，失败整组回滚并提示（服务端仍是最终裁决） */
  const deleteComment = React.useCallback(
    async (commentId: string): Promise<void> => {
      if (kind !== 'wall' || !post) return;
      const snapshotNodes = nodes;
      setCommentDeleteFailed(false);
      setNodes((current) => current.filter((node) => node.id !== commentId));
      try {
        const acknowledgement = await deleteConfessionComment(post.id, Number(commentId));
        if (!acknowledgement || typeof acknowledgement !== 'object' || (acknowledgement as { status?: unknown }).status !== 0) {
          throw new Error('Invalid comment delete acknowledgement');
        }
      } catch {
        setNodes(snapshotNodes);
        setCommentDeleteFailed(true);
      }
    },
    [kind, nodes, post]
  );

  React.useEffect(() => {
    ++epoch.current;
    locks.current = { send: false, read: false };
    setNodes([]);
    setDraft('');
    setReply(null);
    setSending(false);
    setNotice(null);
    dispatch({ type: 'append:success', hasMore: false });
    void loadComments();
    return () => {
      ++epoch.current;
    };
  }, [post, kind, loadComments, dispatch]);

  const allowed = () => {
    if (session.isSignedIn) return true;
    setNotice('login');
    return false;
  };

  const send = async () => {
    const content = draftRef.current.trim();
    const parent = replyRef.current;
    if (
      !post ||
      locks.current.send ||
      locks.current.read ||
      !allowed() ||
      !content ||
      (kind === 'wall' && content.length > 500)
    ) {
      return;
    }
    const original = draftRef.current;
    const request = epoch.current;
    locks.current.send = true;
    setSending(true);
    setNotice(null);
    try {
      const payload = parent ? { content, parent_id: Number(parent.id) } : { content };
      const data =
        kind === 'wall'
          ? await createConfessionComment(post.id, payload)
          : await createComment(post.id, payload);
      if (request !== epoch.current) return;
      const node = comment(data, kind, parent ? Number(parent.id) : null, t, locale);
      setNodes((current) => (current.some((item) => item.id === node.id) ? current : [...current, node]));
      like.incrementCommentCount();
      // 发送成功后**只清空"这次发出的内容"**：发送期间用户新打的内容不得被旧响应清掉
      if (draftRef.current === original && replyRef.current?.id === parent?.id) {
        setDraft('');
        setReply(null);
      }
    } catch (error) {
      const auth = classifyAuthFailure(error);
      if (request !== epoch.current) return;
      if (isSessionInvalid(auth)) await session.handleAuthFailure(error);
      if (request === epoch.current) {
        setNotice(isSessionInvalid(auth) ? 'login' : auth === 'sanctioned' ? 'denied' : 'sendFailed');
      }
    } finally {
      if (request === epoch.current) {
        locks.current.send = false;
        setSending(false);
      }
    }
  };

  const replyContext: CommentReplyContext | undefined =
    reply === null
      ? undefined
      : kind === 'wall' || reply.author.kind === 'anonymous'
        ? {
            kind: 'anonymous',
            anonymousLabel: t('screen.campus.write.replying'),
            cancelLabel: t('action.cancel'),
            onCancel: () => setReply(null),
          }
        : {
            kind: 'named',
            label: t('screen.campus.write.namedReply', { name: reply.author.name }),
            cancelLabel: t('action.cancel'),
            onCancel: () => setReply(null),
          };

  return {
    interactions: { liked: like.liked, likeCount: like.likeCount, commentCount: like.commentCount },
    onToggleLike: like.onToggleLike,
    likeNotice: like.notice,
    comments: {
      nodes,
      loading: pagination.append === 'loading',
      error: pagination.append === 'error',
      retry: () => void loadComments(),
      onReply: (id: string) => {
        const node = nodes.find((item) => item.id === id && item.depth === 0);
        if (node) setReply(node);
      },
      deleteComment: (id: string) => void deleteComment(id),
      deleteFailed: commentDeleteFailed,
    },
    reply,
    cancelReply: () => setReply(null),
    replyContext,
    draft,
    setDraft,
    sending,
    send: () => void send(),
    composeNotice: notice,
    report: { state: report.state, submit: report.submit },
  };
}
