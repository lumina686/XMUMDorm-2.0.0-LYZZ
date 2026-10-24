const { updateChatScroll } = require('../../shared/utils/chatScroll');

test('scrolling up pauses following even inside the bottom threshold', () => {
  expect(updateChatScroll({ top: 600, following: true }, { top: 594, height: 1000, viewport: 400 }))
    .toEqual({ top: 594, following: false });
});

test('content updates without scrolling do not resume following', () => {
  expect(updateChatScroll({ top: 594, following: false }, { top: 594, height: 1000, viewport: 400 }).following).toBe(false);
  expect(updateChatScroll({ top: 200, following: false }, { top: 200, height: 1500, viewport: 400 }).following).toBe(false);
});

test('scrolling down resumes following only near the bottom', () => {
  const state = updateChatScroll({ top: 200, following: false }, { top: 300, height: 1000, viewport: 400 });
  expect(state.following).toBe(false);
  expect(updateChatScroll(state, { top: 590, height: 1000, viewport: 400 }).following).toBe(true);
});

test('touch bounce and an empty list keep valid positions', () => {
  expect(updateChatScroll({ top: 0, following: false }, { top: -20, height: 1000, viewport: 400 }))
    .toEqual({ top: 0, following: false });
  expect(updateChatScroll({ top: 0, following: true }, { top: 0, height: 100, viewport: 400 }).following).toBe(true);
});
