import * as React from 'react';

import {useClubAction} from './useClubAction';
import {toggleClubFollow} from '../../../../shared/api/clubs';

export type ClubFollowState = 'idle' | 'working' | 'success' | 'login' | 'denied' | 'failed';
type ClubFollowTarget = {clubId: number; following: boolean; followers: number};

function readAcknowledgement(value: unknown, clubId: number): Pick<ClubFollowTarget, 'following' | 'followers'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid club follow acknowledgement');
  const row = value as Record<string, unknown>;
  if (
    row.clubId !== clubId || typeof row.following !== 'boolean' ||
    !Number.isSafeInteger(row.followers) || Number(row.followers) < 0
  ) throw new Error('Invalid club follow acknowledgement');
  return {following: row.following, followers: row.followers as number};
}

/** Shares a server-authoritative follow state between discovery and profile consumers. */
export function useClubFollow(target: ClubFollowTarget): {
  following: boolean;
  followers: number;
  state: ClubFollowState;
  toggle: () => Promise<void>;
} {
  const [following, setFollowing] = React.useState(target.following);
  const [followers, setFollowers] = React.useState(target.followers);
  const action = useClubAction<void>({
    request: () => toggleClubFollow(target.clubId),
    apply: (value) => {
      const next = readAcknowledgement(value, target.clubId);
      setFollowing(next.following);
      setFollowers(next.followers);
      return 'success';
    },
  });

  React.useEffect(() => {
    action.reset();
    setFollowing(target.following);
    setFollowers(target.followers);
    return () => { action.reset(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.clubId, target.following, target.followers]);

  const toggle = React.useCallback(async (): Promise<void> => {
    if (!Number.isSafeInteger(target.clubId) || target.clubId <= 0) return;
    await action.perform(undefined);
  }, [action, target.clubId]);

  return {following, followers, state: action.state, toggle};
}
