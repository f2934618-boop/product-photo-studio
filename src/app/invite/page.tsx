import { InviteClient } from "@/components/invite/invite-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `邀请有礼 — ${BRAND}` };

export default function InvitePage() {
  return <InviteClient />;
}
