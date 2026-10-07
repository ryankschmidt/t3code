/** Copy a native plain-text scrollback capture, not the ANSI PTY replay buffer. */
export async function copyTerminalOutput(
  text: string,
  writeClipboard: (text: string) => Promise<unknown>,
): Promise<boolean> {
  if (!text.trim()) return false;
  await writeClipboard(text);
  return true;
}
