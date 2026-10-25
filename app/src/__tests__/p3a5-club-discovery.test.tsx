import * as React from 'react';
import { fireEvent, waitFor, within } from '@testing-library/react-native';

import { renderApp } from './helpers/renderApp';

jest.mock('expo-router', () => {
  const state = { pushed: [] as unknown[], replaced: [] as unknown[], params: {} as Record<string, string> };
  return {
    __state: state,
    useRouter: () => ({
      push: (target: unknown) => state.pushed.push(target),
      replace: (target: unknown) => state.replaced.push(target),
      back: () => undefined,
      canGoBack: () => false,
    }),
  };
});

jest.mock('../../../shared/api/clubs', () => ({ listClubs: jest.fn(), getClubProfile: jest.fn() }));
jest.mock('@/features/clubs/useClubFollow', () => ({ useClubFollow: jest.fn() }));

const api = require('../../../shared/api/clubs') as { listClubs: jest.Mock; getClubProfile: jest.Mock };
const follow = require('@/features/clubs/useClubFollow').useClubFollow as jest.Mock;
const routerState = require('expo-router').__state as { pushed: unknown[]; replaced: unknown[]; params: Record<string, string> };
const { ClubDiscoveryScreen, ClubProfileScreen } = require('@/features/clubs/ClubScreens') as typeof import('@/features/clubs/ClubScreens');

const CLUB = {
  id: 7,
  name: 'Music Club',
  category: 'music',
  description: 'Play together',
  avatar: null,
  followers: 3,
  viewer: { following: false },
};

const PROFILE = {
  id: 7,
  basicInfo: { ...CLUB, viewer: { following: false, canManage: true, isMember: true } },
  joinInfo: { contactText: 'music@example.com', signupLink: '', ig: '', xhs: '' },
  members: [{ id: 1, role: 'admin', email: 'a@example.com', username: 'admin', nickname: 'Admin', avatar: null }],
  activities: [],
  posts: [],
};

beforeEach(() => {
  api.listClubs.mockReset();
  api.getClubProfile.mockReset();
  follow.mockReset().mockReturnValue({ following: false, followers: 3, state: 'idle', toggle: jest.fn() });
  routerState.pushed.length = 0;
  routerState.replaced.length = 0;
});

describe('P3A5-02 社团发现与主页', () => {
  it('发现页显示经模型验证的社团，并进入主页', async () => {
    api.listClubs.mockResolvedValue({ list: [CLUB], page: 1, pageSize: 20, hasMore: false });
    const view = await renderApp(<ClubDiscoveryScreen />);

    await waitFor(() => expect(view.getByTestId('club-list-row-7')).toBeTruthy());
    const user = require('@testing-library/react-native').userEvent.setup();
    await user.press(view.getByTestId('club-list-row-7'));
    expect(routerState.pushed).toEqual(['/clubs/7']);
  });

  it.each([
    [true, true],
    [false, false],
  ])('主页只按服务端 canManage=%s 决定管理入口', async (canManage, visible) => {
    api.getClubProfile.mockResolvedValue({ ...PROFILE, basicInfo: { ...PROFILE.basicInfo, viewer: { following: false, canManage, isMember: false } } });
    const view = await renderApp(<ClubProfileScreen clubId="7" />);

    await waitFor(() => expect(view.getByTestId('club-profile-followers')).toBeTruthy());
    if (visible) expect(view.getByTestId('club-profile-manage')).toBeTruthy();
    else expect(view.queryByTestId('club-profile-manage')).toBeNull();
  });

  it('非法主页参数不请求服务端，并返回发现页', async () => {
    const view = await renderApp(<ClubProfileScreen clubId="not-an-id" />);

    await waitFor(() => expect(view.getByTestId('club-profile-unavailable')).toBeTruthy());
    expect(api.getClubProfile).not.toHaveBeenCalled();
    const user = require('@testing-library/react-native').userEvent.setup();
    await user.press(view.getByTestId('club-profile-back'));
    expect(routerState.replaced).toEqual(['/clubs']);
  });

  it('未登录点关注出现登录引导，点击前往登录', async () => {
    api.getClubProfile.mockResolvedValue(PROFILE);
    follow.mockReturnValue({ following: false, followers: 3, state: 'login', toggle: jest.fn() });
    const view = await renderApp(<ClubProfileScreen clubId="7" />);

    await waitFor(() => expect(view.getByTestId('club-profile-follow-notice')).toBeTruthy());
    fireEvent.press(within(view.getByTestId('club-profile-follow-notice')).getByText('登录'));
    expect(routerState.pushed).toEqual(['/login']);
  });

  it('关注失败出现可读的原因提示', async () => {
    api.getClubProfile.mockResolvedValue(PROFILE);
    follow.mockReturnValue({ following: false, followers: 3, state: 'failed', toggle: jest.fn() });
    const view = await renderApp(<ClubProfileScreen clubId="7" />);

    await waitFor(() => expect(view.getByTestId('club-profile-follow-notice')).toBeTruthy());
  });

  it('空闲态不渲染任何关注提示', async () => {
    api.getClubProfile.mockResolvedValue(PROFILE);
    const view = await renderApp(<ClubProfileScreen clubId="7" />);

    await waitFor(() => expect(view.getByTestId('club-profile-follow')).toBeTruthy());
    expect(view.queryByTestId('club-profile-follow-notice')).toBeNull();
  });
});
