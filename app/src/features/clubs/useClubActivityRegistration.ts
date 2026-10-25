import * as React from 'react';

import {useClubAction} from './useClubAction';
import {cancelClubActivityRegistration, registerClubActivity} from '../../../../shared/api/clubs';

export type ClubActivityRegistration = {
  activityId: number;
  registered: boolean;
  count: number;
  deadline: string | null;
};

export type ClubActivityRegistrationState =
  | 'idle'
  | 'working'
  | 'registered'
  | 'cancelled'
  | 'login'
  | 'denied'
  | 'failed';

function readRegistration(value: unknown, expectedActivityId: number): ClubActivityRegistration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid activity registration');
  const row = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(row.activityId) || row.activityId !== expectedActivityId ||
    typeof row.registered !== 'boolean' ||
    !Number.isSafeInteger(row.count) || Number(row.count) < 0 ||
    (row.deadline !== null && typeof row.deadline !== 'string')
  ) throw new Error('Invalid activity registration');
  return {
    activityId: row.activityId as number,
    registered: row.registered as boolean,
    count: row.count as number,
    deadline: row.deadline as string | null,
  };
}

/**
 * Activity registration is a server-owned state transition. The returned count is
 * never incremented or decremented locally, so retries and parallel clients cannot
 * make the App display an invented attendance number.
 */
export function useClubActivityRegistration(activityId: number | null): {
  snapshot: ClubActivityRegistration | null;
  state: ClubActivityRegistrationState;
  register: () => Promise<void>;
  cancel: () => Promise<void>;
} {
  const [snapshot, setSnapshot] = React.useState<ClubActivityRegistration | null>(null);
  const action = useClubAction<'register' | 'cancel', ClubActivityRegistrationState>({
    request: (act) => (act === 'register' ? registerClubActivity(activityId as number) : cancelClubActivityRegistration(activityId as number)),
    apply: (value) => {
      const next = readRegistration(value, activityId as number);
      setSnapshot(next);
      return next.registered ? 'registered' : 'cancelled';
    },
  });

  React.useEffect(() => {
    action.reset();
    setSnapshot(null);
    return () => { action.reset(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId]);

  const update = React.useCallback(async (act: 'register' | 'cancel'): Promise<void> => {
    if (typeof activityId !== 'number' || !Number.isSafeInteger(activityId) || activityId <= 0) return;
    await action.perform(act);
  }, [action, activityId]);

  return {
    snapshot,
    state: action.state,
    register: () => update('register'),
    cancel: () => update('cancel'),
  };
}
