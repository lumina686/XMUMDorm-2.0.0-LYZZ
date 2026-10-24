import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft, ArrowUp, BookOpen, Check, History, MessageCircle, Plus, Trash2, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContextState';
import { useLanguage } from '../../context/LanguageContextState';
import { createAgentConversation, deleteAgentConversation, getAgentConversation, listAgentConversations, restoreAgentConversation, streamAgentChat } from '@shared/api/agent';
import './AgentChat.css';

export default function AgentChat() {
  const { isLoggedIn, user, userLoading } = useAuth();
  const { lang } = useLanguage();
  const zh = lang !== 'en';
  if (!isLoggedIn) return (
    <section className="agent-page agent-gate">
      <BookOpen size={32} aria-hidden="true" />
      <h1>{zh ? '校园助手' : 'Campus assistant'}</h1>
      <p>{zh ? '登录后提问，回答和会话会为你保存。' : 'Sign in to ask questions and keep your conversations.'}</p>
      <Link className="agent-primary" to="/login" state={{ from: { pathname: '/agent' } }}>{zh ? '去登录' : 'Sign in'}</Link>
    </section>
  );
  if (userLoading || !user?.id) return <section className="agent-page" role="status">{zh ? '正在读取账号…' : 'Loading account…'}</section>;
  return <AgentWorkspace key={user.id} userId={user.id} zh={zh} />;
}

function AgentWorkspace({ userId, zh }) {
  const queryClient = useQueryClient();
  // Each visit starts a draft; persist only after the first message is sent.
  const [selected, setSelected] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [lastDeleted, setLastDeleted] = useState(null);
  const [input, setInput] = useState('');
  const [turn, setTurn] = useState(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const controller = useRef(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const tail = useRef(null);
  const textarea = useRef(null);
  const historyDialog = useRef(null);
  const historyMutation = useRef(false);
  const listKey = ['agent', userId, 'conversations'];
  const list = useQuery({ queryKey: listKey, queryFn: ({ signal }) => listAgentConversations(signal), enabled: historyOpen, retry: false });
  const items = list.data?.conversations || [];
  const id = selected;
  const detailKey = ['agent', userId, 'conversation', id];
  const detail = useQuery({
    queryKey: detailKey, queryFn: ({ signal }) => getAgentConversation(id, signal),
    enabled: !!id, retry: false,
    refetchInterval: query => !inFlight.current && query.state.data?.running ? 1500 : false,
  });
  const state = detail.data;
  const pending = state?.pending || [];
  const error = id ? detail.error : null;
  const locked = working || (!!id && (!state || detail.isFetching)) || !!state?.running || !!state?.exhausted || pending.length > 0;
  const messages = turn ? [
    ...turn.messages,
    ...(turn.question ? [{ role: 'user', text: turn.question }] : []),
    { role: 'assistant', text: turn.text },
  ] : state?.messages || [];

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => { tail.current?.scrollIntoView({ block: 'nearest' }); }, [turn?.text, messages.length, pending.length]);
  useEffect(() => {
    const dialog = historyDialog.current;
    if (historyOpen && !dialog.open) dialog.showModal();
    if (!historyOpen && dialog.open) dialog.close();
  }, [historyOpen]);

  function select(value) {
    if (historyMutation.current) return;
    setSelected(value);
    setNotice('');
    setInput('');
    setTurn(null);
    setHistoryOpen(false);
  }

  async function changeHistory(item, restore = false) {
    if (historyMutation.current || inFlight.current) return;
    historyMutation.current = true;
    setHistoryBusy(true);
    setHistoryError('');
    try {
      if (restore) {
        await restoreAgentConversation(item.id);
        if (alive.current) setLastDeleted(null);
      } else {
        await deleteAgentConversation(item.id);
        queryClient.setQueryData(listKey, data => data ? { ...data, conversations: data.conversations.filter(entry => entry.id !== item.id) } : data);
        if (alive.current) {
          setLastDeleted(item);
          if (id === item.id) { setSelected(''); setInput(''); setTurn(null); setNotice(''); }
        }
        queryClient.removeQueries({ queryKey: ['agent', userId, 'conversation', item.id], exact: true });
      }
      await queryClient.invalidateQueries({ queryKey: listKey });
    } catch (failure) {
      if (alive.current) setHistoryError(failure.message);
    } finally {
      historyMutation.current = false;
      if (alive.current) setHistoryBusy(false);
    }
  }

  async function refresh() {
    setNotice('');
    if (id) await detail.refetch();
  }

  function create() {
    if (inFlight.current) return;
    select('');
  }

  async function run(body) {
    if (inFlight.current || state?.running || (id && !state) || (!id && !body.message)) return;
    inFlight.current = true;
    setWorking(true);
    setNotice('');
    setTurn({ messages: state?.messages || [], question: body.message, text: '' });
    const abort = new AbortController();
    controller.current = abort;
    let activeId = id;
    try {
      if (!activeId) {
        const item = await createAgentConversation(abort.signal);
        if (!alive.current || abort.signal.aborted) return;
        activeId = item.id;
        setSelected(activeId);
      }
      await streamAgentChat({
        ...body, conversation_id: activeId,
        ...(body.message ? {} : { checkpoint_id: state?.checkpoint_id }),
      }, event => {
        if (!alive.current) return;
        if (event.type === 'token') setTurn(previous => previous ? { ...previous, text: previous.text + event.text } : previous);
        if (event.type === 'error' || event.type === 'limit') setNotice(event.message);
      }, { signal: abort.signal });
    } catch (failure) {
      if (alive.current) setNotice(failure.name === 'AbortError'
        ? (zh ? '已断开接收，结果会自动更新。' : 'Disconnected. The result will update automatically.')
        : failure.message);
    } finally {
      // Read server state once. Never automatically resend a potentially completed turn.
      if (alive.current) {
        await Promise.all([
          ...(activeId ? [queryClient.invalidateQueries({ queryKey: ['agent', userId, 'conversation', activeId] })] : []),
          queryClient.invalidateQueries({ queryKey: listKey }),
        ]);
      }
      inFlight.current = false;
      if (alive.current) { setTurn(null); setWorking(false); controller.current = null; textarea.current?.focus(); }
    }
  }

  function send(event) {
    event?.preventDefault();
    if (locked || !input.trim()) return;
    const message = input.trim();
    setInput('');
    void run({ message });
  }

  const questions = zh ? ['我明天几点上课？', '还有哪些待办没做完？', '学校附近有什么好吃的？']
    : ['What time are my classes tomorrow?', 'What’s still on my to-do list?', 'Where can I eat near campus?'];
  return (
    <section className="agent-page">
      <header className="agent-heading">
        <Link to="/about" className="agent-back" aria-label={zh ? '返回广场' : 'Back to square'}><ArrowLeft size={20} /></Link>
        <div><h1>{zh ? '校园助手' : 'Campus assistant'}</h1><p>{zh ? '解答你的校园问题。' : 'Answers to your campus questions.'}</p></div>
        <button type="button" className="agent-action agent-history-trigger" disabled={working}
          aria-label={zh ? '历史会话' : 'Conversation history'} aria-haspopup="dialog" onClick={() => setHistoryOpen(true)}>
          <History size={19} aria-hidden="true" /><span>{zh ? '历史会话' : 'History'}</span>
        </button>
      </header>
      <dialog ref={historyDialog} className="agent-history-dialog" aria-labelledby="agent-history-title"
        onCancel={() => setHistoryOpen(false)} onClose={() => setHistoryOpen(false)}
        onClick={event => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setHistoryOpen(false);
        }}>
        <div className="agent-history-heading">
          <h2 id="agent-history-title">{zh ? '历史会话' : 'Conversation history'}</h2>
          <button type="button" className="agent-action agent-history-close" aria-label={zh ? '关闭历史会话' : 'Close history'} onClick={() => setHistoryOpen(false)}><X size={18} /></button>
        </div>
        <button type="button" className="agent-action agent-history-new" disabled={historyBusy} onClick={create}><Plus size={18} />{zh ? '新建对话' : 'New conversation'}</button>
        {lastDeleted && <div className="agent-history-feedback" role="status"><span>{zh ? '已删除会话' : 'Conversation deleted'}</span><button type="button" className="agent-action" disabled={historyBusy} onClick={() => changeHistory(lastDeleted, true)}>{zh ? '撤销' : 'Undo'}</button></div>}
        {historyError && <p className="agent-notice" role="alert">{historyError}</p>}
        <div className="agent-history-list">
          {list.isPending ? <p className="agent-status" role="status">{zh ? '正在读取历史会话…' : 'Loading conversations…'}</p> : null}
          {list.error ? <div className="agent-notice" role="alert"><p>{list.error.message}</p><button type="button" className="agent-action" onClick={() => list.refetch()}>{zh ? '重试' : 'Retry'}</button></div> : null}
          {!list.isPending && !list.error && !items.length ? <p className="agent-status">{zh ? '暂无历史会话' : 'No conversations yet.'}</p> : null}
          {items.map(item => <div key={item.id} className="agent-history-row">
            <button type="button" className="agent-history-item" disabled={historyBusy} aria-current={id === item.id ? 'true' : undefined} onClick={() => select(item.id)}>
              <span>{item.title === '新会话' ? (zh ? '新对话' : 'New conversation') : item.title}</span>
              <time dateTime={item.created_at ? new Date(item.created_at * 1000).toISOString() : undefined}>{item.created_at ? new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-GB', { timeZone: 'Asia/Kuala_Lumpur', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(item.created_at * 1000)) : (zh ? '较早会话' : 'Earlier conversation')}</time>
            </button>
            <button type="button" className="agent-action agent-history-delete" disabled={historyBusy} aria-label={(zh ? '删除会话：' : 'Delete conversation: ') + item.title} title={zh ? '删除会话' : 'Delete conversation'} onClick={() => changeHistory(item)}><Trash2 size={17} aria-hidden="true" /></button>
          </div>)}
        </div>
      </dialog>
      {(notice || error) && <div className="agent-notice" role="alert">{notice || error.message}
        {error?.status === 401 || error?.status === 403 ? <Link to="/login">{zh ? '重新登录' : 'Sign in again'}</Link> : null}
        {error && error.status !== 401 && error.status !== 403 && <button type="button" className="agent-action" onClick={refresh} disabled={list.isFetching || detail.isFetching}>{zh ? '重试' : 'Retry'}</button>}
      </div>}
      {state?.running && !working && <p className="agent-status" role="status">{zh ? '正在处理，完成后会自动显示。' : 'Still working. The result will appear here.'}</p>}
      {state?.exhausted && <div className="agent-status"><p>{zh ? '这个会话的额度已用完。' : 'Conversation limit reached.'}</p>
        <button type="button" className="agent-action" onClick={create} disabled={working}>{zh ? '开始新对话' : 'Start a new conversation'}</button>
      </div>}
      <div className="agent-messages" role="log" aria-label={zh ? '对话记录' : 'Messages'}>
        {id && detail.isPending ? <p className="agent-status" role="status">{zh ? '正在读取会话…' : 'Loading conversation…'}</p> : null}
        {!messages.length && !working && !error && (!id || state) && <div className="agent-empty">
          <div className="agent-empty-mark"><MessageCircle size={28} aria-hidden="true" /></div>
          <h2>{zh ? '校园里的问题，从这里问。' : 'A place for campus questions.'}</h2>
          <p>{zh ? '输入你的问题，直接获取解答。' : 'Ask a question to get an answer.'}</p>
          <div className="agent-suggestions">{questions.map(question => <button key={question} type="button" onClick={() => { setInput(question); textarea.current?.focus(); }}>{question}<ArrowUp size={16} aria-hidden="true" /></button>)}</div>
        </div>}
        {messages.map((message, index) => <article key={index} className={`agent-message agent-message--${message.role}`}>
          <span className="agent-message-author">{message.role === 'user' ? (zh ? '你' : 'You') : (zh ? '校园助手' : 'Assistant')}</span>
          <div className="agent-message-body">{message.role === 'user' ? message.text : message.text
            ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{message.text}</ReactMarkdown>
            : <span className="agent-thinking" role="status">{zh ? '正在思考…' : 'Thinking…'}</span>}</div>
        </article>)}
        <div ref={tail} />
      </div>
      {!!pending.length && !working && <section className="agent-confirm" aria-label={zh ? '待确认操作' : 'Approval required'}>
        <strong>{zh ? '请确认这些操作' : 'Review these actions'}</strong>
        {pending.map((action, index) => <p key={index}>{action.description || action.tool}</p>)}
        <div><button type="button" className="agent-primary" disabled={pending.some(a => !a.allowed_decisions.includes('approve'))} onClick={() => run({ decisions: pending.map(() => ({ type: 'approve' })) })}><Check size={16} />{zh ? '确认执行' : 'Approve'}</button>
          <button type="button" className="agent-action" disabled={pending.some(a => !a.allowed_decisions.includes('reject'))} onClick={() => run({ decisions: pending.map(() => ({ type: 'reject' })) })}><X size={16} />{zh ? '取消操作' : 'Reject'}</button></div>
      </section>}
      <form className="agent-composer" onSubmit={send}>
        <label className="agent-sr-only" htmlFor="agent-question">{zh ? '输入你的问题' : 'Your question'}</label>
        <textarea id="agent-question" ref={textarea} rows={2} maxLength={4000} value={input} disabled={locked}
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) send(event); }} />
        <div className="agent-composer-bottom">
          {working ? <button type="button" className="agent-action" onClick={() => controller.current?.abort()}>{zh ? '稍后查看' : 'Check later'}</button>
            : <button type="submit" className="agent-send" disabled={locked || !input.trim()} aria-label={zh ? '发送' : 'Send'}><ArrowUp size={20} /></button>}
        </div>
      </form>
    </section>
  );
}
