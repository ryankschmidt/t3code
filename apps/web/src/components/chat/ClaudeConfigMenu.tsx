import type { ProviderOptionDescriptor, ServerProviderModel } from "@t3tools/contracts";
import { getProviderOptionCurrentValue } from "@t3tools/shared/model";
import { CLAUDE_TERMINAL_ONLY_SETTINGS } from "@t3tools/shared/claudeComposerMenus";
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogPanel,
} from "../ui/dialog";

export function ClaudeConfigMenu(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  getModelDisabledReason?: (model: string) => string | null;
  onModelChange: (model: string) => void;
  onOptionChange: (id: string, value: string | boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Claude Code configuration</DialogTitle>
          <DialogDescription>
            Session settings passed to Claude on the next turn. This menu does not modify the host's
            CLI preferences.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto py-3">
            <label className="flex flex-col gap-1">
              Model
              <select
                aria-label="Model"
                className="rounded-md border bg-background p-2"
                value={props.model}
                onChange={(event) => props.onModelChange(event.target.value)}
              >
                {!props.models.some((model) => model.slug === props.model) && (
                  <option value={props.model}>{props.model}</option>
                )}
                {props.models.map((model) => (
                  <option
                    key={model.slug}
                    value={model.slug}
                    disabled={!!props.getModelDisabledReason?.(model.slug)}
                  >
                    {model.name}
                  </option>
                ))}
              </select>
            </label>
            {props.descriptors.map((descriptor) => (
              <label key={descriptor.id} className="flex flex-col gap-1">
                {descriptor.label}
                {descriptor.type === "boolean" ? (
                  <input
                    aria-label={descriptor.label}
                    type="checkbox"
                    checked={getProviderOptionCurrentValue(descriptor) === true}
                    onChange={(event) => props.onOptionChange(descriptor.id, event.target.checked)}
                  />
                ) : (
                  <select
                    aria-label={descriptor.label}
                    className="rounded-md border bg-background p-2"
                    value={String(getProviderOptionCurrentValue(descriptor) ?? "")}
                    onChange={(event) => props.onOptionChange(descriptor.id, event.target.value)}
                  >
                    {descriptor.options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            ))}
            {CLAUDE_TERMINAL_ONLY_SETTINGS.map((setting) => (
              <div key={setting.label} aria-disabled="true" className="text-muted-foreground">
                <p>{setting.label}</p>
                <p className="text-xs">{setting.reason}</p>
              </div>
            ))}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
