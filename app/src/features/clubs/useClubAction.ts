import * as React from 'react';

import {useSession} from '@/features/auth/session';
import {classifyAuthFailure, isSessionInvalid} from '@/features/auth/authFailure';

/**
 * 社团交互（关注/点赞/报名）共用的动作状态机：epoch/锁/六态/会话门/失败分型只有这一份。
 * 目标校验、回执校验与成功态由各 hook 注入；reset 由调用方在自己的 effect 里触发。
 */
export type ClubActionState = 'idle' | 'working' | 'success' | 'login' | 'denied' | 'failed';

export function useClubAction<A, S extends string = ClubActionState>(options: {
  request: (action: A) => Promise<unknown>;
  /** 服务端回执匹配后调用：写入本地状态并返回成功态（报名按回执区分 registered/cancelled） */
  apply: (value: unknown) => S;
}): {
  state: S;
  perform: (action: A) => Promise<void>;
  reset: () => void;
} {
  const session = useSession();
  const [state, setState] = React.useState<ClubActionState | S>('idle');
  const epoch = React.useRef(0);
  const locked = React.useRef(false);
  const optionsRef = React.useRef(options);
  optionsRef.current = options;

  const reset = React.useCallback((): void => {
    epoch.current += 1;
    locked.current = false;
    setState('idle');
  }, []);

  const perform = React.useCallback(async (action: A): Promise<void> => {
    if (locked.current) return;
    if (!session.isSignedIn) {
      setState('login');
      return;
    }
    const request = epoch.current;
    locked.current = true;
    setState('working');
    try {
      const value = await optionsRef.current.request(action);
      if (request !== epoch.current) return;
      setState(optionsRef.current.apply(value));
    } catch (error) {
      if (request !== epoch.current) return;
      const failure = classifyAuthFailure(error);
      if (isSessionInvalid(failure)) await session.handleAuthFailure(error);
      if (request !== epoch.current) return;
      setState(isSessionInvalid(failure) ? 'login' : failure === 'sanctioned' ? 'denied' : 'failed');
    } finally {
      if (request === epoch.current) locked.current = false;
    }
  }, [session]);

  // apply 只返回 ClubActionState 的子集，收窄为调用方声明的 S 是运行期安全的
  return {state: state as S, perform, reset};
}
