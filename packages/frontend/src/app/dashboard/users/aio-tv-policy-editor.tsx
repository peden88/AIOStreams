import React from 'react';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { Checkbox } from '@/components/ui/checkbox';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

export interface AioTvAddonAssignment {
  name: string;
  manifestUrl: string;
}

export interface AioTvPolicy {
  enabled: boolean;
  addons: AioTvAddonAssignment[];
  revision: number;
  updatedAt: number;
  updatedBy: string | null;
}

interface Props {
  uuid: string;
  initial: AioTvPolicy;
  onSaved: (policy: AioTvPolicy) => void;
}

const emptyAddon = (): AioTvAddonAssignment => ({
  name: '',
  manifestUrl: '',
});

export function AioTvPolicyEditor({ uuid, initial, onSaved }: Props) {
  const [enabled, setEnabled] = React.useState(initial.enabled);
  const [addons, setAddons] = React.useState<AioTvAddonAssignment[]>(
    initial.addons
  );

  React.useEffect(() => {
    setEnabled(initial.enabled);
    setAddons(initial.addons);
  }, [uuid, initial.revision, initial.enabled, initial.addons]);

  const save = useMutation({
    mutationFn: () =>
      api<AioTvPolicy>(`PUT /dashboard/users/${uuid}/aio-tv`, {
        body: {
          enabled,
          addons: addons.map((addon) => ({
            name: addon.name.trim(),
            manifestUrl: addon.manifestUrl.trim(),
          })),
        },
      }),
    onSuccess: (policy) => {
      toast.success('AIOtv policy saved.');
      onSaved(policy);
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to save AIOtv policy'),
  });

  const updateAddon = (
    index: number,
    patch: Partial<AioTvAddonAssignment>
  ) => {
    setAddons((current) =>
      current.map((addon, i) => (i === index ? { ...addon, ...patch } : addon))
    );
  };

  const removeAddon = (index: number) => {
    setAddons((current) => current.filter((_, i) => i !== index));
  };

  const hasBlankManifest = addons.some((addon) => !addon.manifestUrl.trim());

  return (
    <Card className="p-4 space-y-4 border-brand/30 bg-brand/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold">AIOtv</div>
          <p className="text-xs text-[--muted] mt-1 max-w-2xl">
            This server-side policy is authoritative for the TV client. Assigned
            addons can be installed or removed by the AIOtv sync service; users
            cannot change addon membership on the device.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            value={enabled}
            onValueChange={(v) => setEnabled(v === true)}
            aria-label="Enable AIOtv for this user"
          />
          AIOtv enabled
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium">Assigned addons</div>
            <div className="text-xs text-[--muted]">
              {addons.length} of 50 assigned
            </div>
          </div>
          <Button
            size="sm"
            intent="gray-outline"
            disabled={addons.length >= 50}
            onClick={() => setAddons((current) => [...current, emptyAddon()])}
          >
            Add addon
          </Button>
        </div>

        {addons.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[--border] p-4 text-sm text-[--muted]">
            No addons assigned. The AIOtv account will contain no managed addons.
          </div>
        ) : (
          <div className="space-y-3">
            {addons.map((addon, index) => (
              <div
                key={`${index}-${addon.manifestUrl}`}
                className="rounded-lg border border-[--border]/70 p-3 space-y-2 bg-[--background]/50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[--muted]">
                    Addon {index + 1}
                  </span>
                  <Button
                    size="sm"
                    intent="alert-subtle"
                    onClick={() => removeAddon(index)}
                  >
                    Remove
                  </Button>
                </div>
                <TextInput
                  value={addon.name}
                  onValueChange={(name) => updateAddon(index, { name })}
                  placeholder="Display label (optional)"
                />
                <TextInput
                  value={addon.manifestUrl}
                  onValueChange={(manifestUrl) =>
                    updateAddon(index, { manifestUrl })
                  }
                  placeholder="https://example.com/manifest.json"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="text-xs text-[--muted]">
          {initial.revision > 0 ? (
            <>
              Policy revision {initial.revision}
              {initial.updatedAt > 0 && ` • ${formatDateTime(new Date(initial.updatedAt).toISOString())}`}
              {initial.updatedBy && ` • ${initial.updatedBy}`}
            </>
          ) : (
            'No AIOtv policy has been saved for this user yet.'
          )}
        </div>
        <Button
          size="sm"
          intent="brand-solid"
          loading={save.isPending}
          disabled={save.isPending || hasBlankManifest}
          onClick={() => save.mutate()}
        >
          Save AIOtv policy
        </Button>
      </div>
    </Card>
  );
}
