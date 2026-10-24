/** Follow new messages until the reader scrolls up, even a few pixels. */
export function updateChatScroll(previous, { top, height, viewport }, threshold = 48) {
  const position = Math.max(0, top);
  const distance = Math.max(0, height - viewport - position);
  let following = previous.following;
  if (position < previous.top) following = false;
  else if (position > previous.top && distance <= threshold) following = true;
  return { top: position, following };
}
