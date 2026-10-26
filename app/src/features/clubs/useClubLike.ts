import * as React from 'react';

import {useClubAction} from './useClubAction';
import {toggleClubLike} from '../../../../shared/api/clubs';

export type ClubLikeTargetType = 'activity' | 'post';
export type ClubLikeState = 'idle' | 'working' | 'success' | 'login' | 'denied' | 'failed';

type ClubLikeTarget = {
  targetType: ClubLikeTargetType;
  targetId: number;
  liked: boolean;
  count: number;
};

function readAcknowledgement(value: unknown, target: Pick<ClubLikeTarget, 'targetType' | 'targetId'>): Pick<ClubLikeTarget, 'liked' | 'count'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid club like acknowledgement');
  const row = value as Record<string, unknown>;
  if (
    row.targetType !== target.targetType || row.targetId !== target.targetId ||
    typeof row.liked !== 'boolean' || !Number.isSafeInteger(row.count) || Number(row.count) < 0
  ) throw new Error('Invalid club like acknowledgement');
  return {liked: row.liked, count: row.count as number};
}

/** Shared activity/post like state. It accepts only a matching server acknowledgement. */
export function useClubLike(target: ClubLikeTarget): {
  liked: boolean;
  count: number;
  state: ClubLikeState;
  toggle: () => Promise<void>;
} {
  const [liked, setLiked] = React.useState(target.liked);
  const [count, setCount] = React.useState(target.count);
  const action = useClubAction<void>({
    request: () => toggleClubLike(target.targetType, target.targetId),
    apply: (value) => {
      const next = readAcknowledgement(value, target);
      setLiked(next.liked);
      setCount(next.count);
      return 'success';
    },
  });

  React.useEffect(() => {
    action.reset();
    setLiked(target.liked);
    setCount(target.count);
    return () => { action.reset(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.targetType, target.targetId, target.liked, target.count]);

  const toggle = React.useCallback(async (): Promise<void> => {
    if (!Number.isSafeInteger(target.targetId) || target.targetId <= 0) return;
    await action.perform(undefined);
  }, [action, target.targetId]);

  return {liked, count, state: action.state, toggle};
}
