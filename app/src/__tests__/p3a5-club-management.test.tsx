import * as React from 'react';
import { fireEvent, waitFor, within } from '@testing-library/react-native';

import { renderApp } from './helpers/renderApp';

jest.mock('expo-router', () => {
  const state = { pushed: [] as unknown[], replaced: [] as unknown[] };
  return { __state: state, useRouter: () => ({ push: (target: unknown) => state.pushed.push(target), replace: (target: unknown) => state.replaced.push(target) }) };
});
jest.mock('../../../shared/api/clubs', () => ({ listMyClubs: jest.fn(), getClubProfile: jest.fn(), removeClubMember: jest.fn(), deleteClubActivity: jest.fn(), deleteClubPost: jest.fn(), addClubMember: jest.fn() }));

const api = require('../../../shared/api/clubs') as Record<string, jest.Mock>;
const routerState = require('expo-router').__state as { pushed: unknown[]; replaced: unknown[] };
const { MyClubsScreen, ClubManageScreen } = require('@/features/clubs/ClubScreens') as typeof import('@/features/clubs/ClubScreens');

const PROFILE = {
  id: 7,
  basicInfo: { id: 7, name: 'Music Club', category: 'music', description: 'Play together', avatar: null, followers: 3, viewer: { following: false, canManage: true, isMember: true } },
  joinInfo: { contactText: '', signupLink: '', ig: '', xhs: '' },
  members: [
    { id: 1, role: 'admin', email: 'a@example.com', username: 'admin', nickname: 'Admin', avatar: null },
    { id: 2, role: 'member', email: 'm@example.com', username: 'member', nickname: 'Member', avatar: null },
  ],
  activities: [], posts: [],
};

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  routerState.pushed.length = 0;
  routerState.replaced.length = 0;
});

describe('P3A5-04 我的社团与管理入口', () => {
  it('我的社团显示服务端成员列表并进入社团主页', async () => {
    api.listMyClubs.mockResolvedValue({ list: [{ id: 7, name: 'Music Club', avatar: null, description: 'Play together', followers: 3, role: 'member' }] });
    const view = await renderApp(<MyClubsScreen />);

    await waitFor(() => expect(view.getByTestId('my-club-row-7')).toBeTruthy());
    const user = require('@testing-library/react-native').userEvent.setup();
    await user.press(view.getByTestId('my-club-row-7'));
    expect(routerState.pushed).toEqual(['/clubs/7']);
  });

  it('无权限深链不显示管理动作，并可回到社团主页', async () => {
    api.getClubProfile.mockResolvedValue({ ...PROFILE, basicInfo: { ...PROFILE.basicInfo, viewer: { following: false, canManage: false, isMember: true } } });
    const view = await renderApp(<ClubManageScreen clubId="7" />);

    await waitFor(() => expect(view.getByTestId('club-manage-denied')).toBeTruthy());
    expect(view.queryByTestId('club-manage-remove-2')).toBeNull();
    expect(view.queryByTestId('club-manage-invite-input')).toBeNull();
    expect(view.queryByTestId('club-manage-invite')).toBeNull();
    const user = require('@testing-library/react-native').userEvent.setup();
    await user.press(view.getByTestId('club-manage-back'));
    expect(routerState.replaced).toEqual(['/clubs/7']);
  });

  it('管理员删除成员后只以服务端成功回执刷新资料', async () => {
    api.getClubProfile.mockResolvedValue(PROFILE);
    api.removeClubMember.mockResolvedValue({ status: 0 });
    const view = await renderApp(<ClubManageScreen clubId="7" />);

    await waitFor(() => expect(view.getByTestId('club-manage-remove-2')).toBeTruthy());
    const user = require('@testing-library/react-native').userEvent.setup();
    await user.press(view.getByTestId('club-manage-remove-2'));
    const confirmActions = within(view.getByTestId('club-manage-remove-dialog')).getAllByText('移除成员');
    await user.press(confirmActions[confirmActions.length - 1]);
    await waitFor(() => expect(api.removeClubMember).toHaveBeenCalledWith(7, 2));
    expect(api.getClubProfile).toHaveBeenCalledTimes(2);
  });

  it('管理操作网络失败显示原因与补救，而不是笼统重试', async () => {
    api.getClubProfile.mockResolvedValue({ ...PROFILE, activities: [{ id: 5, title: 'Jam' }] });
    api.deleteClubActivity.mockRejectedValue(new TypeError('Network request failed'));
    const view = await renderApp(<ClubManageScreen clubId="7" />);

    await waitFor(() => expect(view.getByText('删除活动 · Jam')).toBeTruthy());
    const user = require('@testing-library/react-native').userEvent.setup();
    await user.press(view.getByText('删除活动 · Jam'));
    await waitFor(() => expect(view.getByTestId('club-manage-notice')).toBeTruthy());
    expect(within(view.getByTestId('club-manage-notice')).getByText(/网络不稳定/)).toBeTruthy();
  });

  it('管理操作被处罚拒绝时显示受限提示', async () => {
    api.getClubProfile.mockResolvedValue({ ...PROFILE, activities: [{ id: 5, title: 'Jam' }] });
    api.deleteClubActivity.mockRejectedValue({ status: 403, body: { muted: true } });
    const view = await renderApp(<ClubManageScreen clubId="7" />);

    await waitFor(() => expect(view.getByText('删除活动 · Jam')).toBeTruthy());
    const user = require('@testing-library/react-native').userEvent.setup();
    await user.press(view.getByText('删除活动 · Jam'));
    await waitFor(() => expect(view.getByTestId('club-manage-notice')).toBeTruthy());
    expect(within(view.getByTestId('club-manage-notice')).getByText(/受限/)).toBeTruthy();
  });

  it('管理员输入邮箱邀请成员，以服务端回执刷新名单', async () => {
    api.getClubProfile.mockResolvedValue(PROFILE);
    api.addClubMember.mockResolvedValue({ status: 0 });
    const view = await renderApp(<ClubManageScreen clubId="7" />);

    await waitFor(() => expect(view.getByTestId('club-manage-invite-input')).toBeTruthy());
    await fireEvent.changeText(view.getByTestId('club-manage-invite-input'), 'new@example.com');
    await fireEvent.press(view.getByTestId('club-manage-invite'));
    await waitFor(() => expect(api.addClubMember).toHaveBeenCalledWith(7, 'new@example.com', 'member'));
    await waitFor(() => expect(api.getClubProfile).toHaveBeenCalledTimes(2));
  });

  it('空邮箱不发起邀请', async () => {
    api.getClubProfile.mockResolvedValue(PROFILE);
    const view = await renderApp(<ClubManageScreen clubId="7" />);

    await waitFor(() => expect(view.getByTestId('club-manage-invite')).toBeTruthy());
    fireEvent.press(view.getByTestId('club-manage-invite'));
    expect(api.addClubMember).not.toHaveBeenCalled();
  });

  it('邀请回执非零不刷新名单且失败提示可见', async () => {
    api.getClubProfile.mockResolvedValue(PROFILE);
    api.addClubMember.mockResolvedValue({ status: -1 });
    const view = await renderApp(<ClubManageScreen clubId="7" />);

    await waitFor(() => expect(view.getByTestId('club-manage-invite-input')).toBeTruthy());
    await fireEvent.changeText(view.getByTestId('club-manage-invite-input'), 'new@example.com');
    await fireEvent.press(view.getByTestId('club-manage-invite'));
    await waitFor(() => expect(view.getByTestId('club-manage-notice')).toBeTruthy());
    expect(api.getClubProfile).toHaveBeenCalledTimes(1);
  });

  it('选管理员后邀请按 admin 角色提交', async () => {
    api.getClubProfile.mockResolvedValue(PROFILE);
    api.addClubMember.mockResolvedValue({ status: 0 });
    const view = await renderApp(<ClubManageScreen clubId="7" />);

    await waitFor(() => expect(view.getByTestId('club-manage-invite-role-admin')).toBeTruthy());
    await fireEvent.changeText(view.getByTestId('club-manage-invite-input'), 'new@example.com');
    await fireEvent.press(view.getByTestId('club-manage-invite-role-admin'));
    await fireEvent.press(view.getByTestId('club-manage-invite'));
    await waitFor(() => expect(api.addClubMember).toHaveBeenCalledWith(7, 'new@example.com', 'admin'));
  });

  it('邀请未注册邮箱给出核对指引，输入保留', async () => {
    api.getClubProfile.mockResolvedValue(PROFILE);
    api.addClubMember.mockRejectedValue({ status: 404, body: { status: -1, message: '未找到该用户' } });
    const view = await renderApp(<ClubManageScreen clubId="7" />);

    await waitFor(() => expect(view.getByTestId('club-manage-invite-input')).toBeTruthy());
    await fireEvent.changeText(view.getByTestId('club-manage-invite-input'), 'ghost@example.com');
    await fireEvent.press(view.getByTestId('club-manage-invite'));
    await waitFor(() => expect(view.getByTestId('club-manage-invite-error')).toBeTruthy());
    expect(within(view.getByTestId('club-manage-invite-error')).getByText(/未注册/)).toBeTruthy();
    expect(view.getByTestId('club-manage-invite-input').props.value).toBe('ghost@example.com');
  });

  it('管理页删除按钮只留动作词，对象名在行文本', async () => {
    api.getClubProfile.mockResolvedValue({ ...PROFILE, posts: [{ id: 12, content: '某条动态' }], activities: [{ id: 5, title: '秋季招新' }] });
    const view = await renderApp(<ClubManageScreen clubId="7" />);

    await waitFor(() => expect(view.getByText('某条动态')).toBeTruthy());
    expect(view.getByTestId('club-manage-delete-post-12').props.label).toBe('删除动态');
    expect(view.getByTestId('club-manage-delete-activity-5').props.label).toBe('删除活动');
  });

  it('成员列表显示角色标签', async () => {
    api.getClubProfile.mockResolvedValue(PROFILE);
    const view = await renderApp(<ClubManageScreen clubId="7" />);

    await waitFor(() => expect(view.getByTestId('club-manage-remove-2')).toBeTruthy());
    expect(within(view.getByTestId('club-manage-member-1')).getByText('管理员')).toBeTruthy();
    expect(within(view.getByTestId('club-manage-member-2')).getByText('成员')).toBeTruthy();
  });
});
