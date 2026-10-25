import * as React from 'react';
import { fireEvent, waitFor, within } from '@testing-library/react-native';

import { renderApp } from './helpers/renderApp';

jest.mock('expo-router', () => {
  const state = { pushed: [] as unknown[], replaced: [] as unknown[] };
  return {
    __state: state,
    useRouter: () => ({ push: (target: unknown) => state.pushed.push(target), replace: (target: unknown) => state.replaced.push(target), back: () => undefined, canGoBack: () => false }),
  };
});
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ isSignedIn: true, handleAuthFailure: jest.fn() }) }));
jest.mock('../../../shared/api/clubs', () => ({
  getActivityDetail: jest.fn(), getClubPostDetail: jest.fn(), getClubActivityComments: jest.fn(), getClubPostComments: jest.fn(),
  createClubActivityComment: jest.fn(), createClubPostComment: jest.fn(), exportClubActivityRegistrations: jest.fn(),
}));
jest.mock('@/features/clubs/useClubLike', () => ({ useClubLike: jest.fn() }));
jest.mock('@/features/clubs/useClubActivityRegistration', () => ({ useClubActivityRegistration: jest.fn() }));

const api = require('../../../shared/api/clubs') as {
  getActivityDetail: jest.Mock; getClubPostDetail: jest.Mock; getClubActivityComments: jest.Mock; getClubPostComments: jest.Mock;
  exportClubActivityRegistrations: jest.Mock;
};
const like = require('@/features/clubs/useClubLike').useClubLike as jest.Mock;
const registration = require('@/features/clubs/useClubActivityRegistration').useClubActivityRegistration as jest.Mock;
const routerState = require('expo-router').__state as { pushed: unknown[]; replaced: unknown[] };
const { ClubActivityDetailScreen, ClubPostDetailScreen } = require('@/features/clubs/ClubScreens') as typeof import('@/features/clubs/ClubScreens');

const ACTIVITY = {
  id: 9, title: 'Jam session', tag: null, summary: 'Bring an instrument', cover: null, images: [],
  time: null, endTime: null, location: null, clubId: 7, clubName: 'Music Club', status: 'upcoming', signupLink: null,
  registration: { count: 2, registered: false, deadline: null }, stats: { likes: 3, views: 0, comments: 0 }, viewer: { liked: false, canManage: false },
};
const POST = {
  id: 10, clubId: 7, clubName: 'Music Club', title: 'Practice notes', content: 'Meet in Hall A', images: [], createdAt: null,
  stats: { likes: 3, views: 0, comments: 0 }, viewer: { liked: false, canManage: false },
};

beforeEach(() => {
  api.getActivityDetail.mockReset();
  api.getClubPostDetail.mockReset();
  api.getClubActivityComments.mockReset().mockResolvedValue([]);
  api.getClubPostComments.mockReset().mockResolvedValue([]);
  like.mockReset().mockReturnValue({ liked: true, count: 3, state: 'success', toggle: jest.fn() });
  registration.mockReset().mockReturnValue({ snapshot: { activityId: 9, registered: true, count: 8, deadline: null }, state: 'registered', register: jest.fn(), cancel: jest.fn() });
  routerState.pushed.length = 0;
  routerState.replaced.length = 0;
});

describe('P3A5-03 社团详情接线', () => {
  it('活动页显示报名 Hook 的服务端回执，并使用取消报名动作', async () => {
    api.getActivityDetail.mockResolvedValue(ACTIVITY);
    const view = await renderApp(<ClubActivityDetailScreen activityId="9" />);

    await waitFor(() => expect(view.getByTestId('club-activity-registration')).toBeTruthy());
    expect(view.getByTestId('club-activity-registration').props.accessibilityLabel).toContain('8');
    const user = require('@testing-library/react-native').userEvent.setup();
    await user.press(view.getByTestId('club-activity-registration'));
    expect(registration.mock.results[0].value.cancel).toHaveBeenCalledTimes(1);
  });

  it('报名名单导出不向普通成员显示', async () => {
    api.getActivityDetail.mockResolvedValue(ACTIVITY);
    const memberView = await renderApp(<ClubActivityDetailScreen activityId="9" />);
    await waitFor(() => expect(memberView.getByTestId('club-activity-registration')).toBeTruthy());
    expect(memberView.queryByTestId('club-activity-export-registrations')).toBeNull();
  });

  it('报名名单导出只给服务端确认的社团管理员显示', async () => {
    api.getActivityDetail.mockResolvedValue({ ...ACTIVITY, viewer: { ...ACTIVITY.viewer, canManage: true } });
    const managerView = await renderApp(<ClubActivityDetailScreen activityId="9" />);
    await waitFor(() => expect(managerView.getByTestId('club-activity-export-registrations')).toBeTruthy());
  });

  it('帖子点赞只调用丙的 Hook，计数由 Hook 回执展示', async () => {
    api.getClubPostDetail.mockResolvedValue(POST);
    const view = await renderApp(<ClubPostDetailScreen postId="10" />);

    await waitFor(() => expect(view.getByTestId('club-post-detail-like')).toBeTruthy());
    expect(view.getByTestId('club-post-detail-like').props.accessibilityLabel).toContain('3');
    const user = require('@testing-library/react-native').userEvent.setup();
    await user.press(view.getByTestId('club-post-detail-like'));
    expect(like.mock.results[0].value.toggle).toHaveBeenCalledTimes(1);
  });

  it('详情冷启动返回所属社团，而不是未注册的通知路径', async () => {
    api.getActivityDetail.mockResolvedValue(ACTIVITY);
    const view = await renderApp(<ClubActivityDetailScreen activityId="9" />);

    await waitFor(() => expect(view.getByTestId('club-activity-detail-back')).toBeTruthy());
    const user = require('@testing-library/react-native').userEvent.setup();
    await user.press(view.getByTestId('club-activity-detail-back'));
    expect(routerState.replaced).toEqual(['/clubs/7']);
  });

  it('未登录报名出现登录引导，点击前往登录', async () => {
    api.getActivityDetail.mockResolvedValue(ACTIVITY);
    registration.mockReturnValue({ snapshot: null, state: 'login', register: jest.fn(), cancel: jest.fn() });
    const view = await renderApp(<ClubActivityDetailScreen activityId="9" />);

    await waitFor(() => expect(view.getByTestId('club-activity-registration-notice')).toBeTruthy());
    fireEvent.press(within(view.getByTestId('club-activity-registration-notice')).getByText('登录'));
    expect(routerState.pushed).toEqual(['/login']);
  });

  it('点赞被拒出现受限提示', async () => {
    api.getClubPostDetail.mockResolvedValue(POST);
    like.mockReturnValue({ liked: false, count: 3, state: 'denied', toggle: jest.fn() });
    const view = await renderApp(<ClubPostDetailScreen postId="10" />);

    await waitFor(() => expect(view.getByTestId('club-like-notice')).toBeTruthy());
  });

  it('报名失败出现原因提示', async () => {
    api.getActivityDetail.mockResolvedValue(ACTIVITY);
    registration.mockReturnValue({ snapshot: null, state: 'failed', register: jest.fn(), cancel: jest.fn() });
    const view = await renderApp(<ClubActivityDetailScreen activityId="9" />);

    await waitFor(() => expect(view.getByTestId('club-activity-registration-notice')).toBeTruthy());
  });

  it('成功与进行中不渲染失败提示', async () => {
    api.getClubPostDetail.mockResolvedValue(POST);
    like.mockReturnValue({ liked: true, count: 3, state: 'success', toggle: jest.fn() });
    const view = await renderApp(<ClubPostDetailScreen postId="10" />);

    await waitFor(() => expect(view.getByTestId('club-post-detail-like')).toBeTruthy());
    expect(view.queryByTestId('club-like-notice')).toBeNull();
  });
});
