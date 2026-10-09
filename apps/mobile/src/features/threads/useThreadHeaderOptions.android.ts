import type { useThreadHeaderOptions as useIosThreadHeaderOptions } from "./useThreadHeaderOptions";
import { createElement } from "react";
import { ThreadCopyButton } from "./copy/ThreadCopySheet";

export function useThreadHeaderOptions(
  props: Parameters<typeof useIosThreadHeaderOptions>[0],
): ReturnType<typeof useIosThreadHeaderOptions> {
  return {
    options: { contentStyle: { backgroundColor: props.headerColor } },
    sidebar: true,
    fallback: props.onCopyThreadIdentity
      ? createElement(ThreadCopyButton, { onPress: props.onCopyThreadIdentity })
      : null,
  };
}
