"use client";

import { useActionState } from "react";
import { setMarketingOptInAction, type MarketingState } from "@/app/(app)/cuenta/actions";
import { Button } from "@/components/ui/button";

export function MarketingPreferenceForm({ optedIn }: { optedIn: boolean }) {
  const [state, action, pending] = useActionState<MarketingState, FormData>(
    setMarketingOptInAction.bind(null, !optedIn),
    {},
  );
  return (
    <form action={action} className="space-y-2">
      <Button type="submit" size="sm" variant={optedIn ? "outline" : "default"} disabled={pending}>
        {pending ? "Guardando…" : optedIn ? "Retirar la autorización" : "Autorizar comunicaciones"}
      </Button>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
