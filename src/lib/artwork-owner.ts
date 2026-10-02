import "server-only";
import { resolveUserEmail, requireAdmin } from "@/lib/admin-auth";

// Never trust an email supplied by the anonymous canvas client. A signed
// workspace cookie owns its own private images; only an admin can select others.
export async function artworkOwner(request: Request, requested: string | null): Promise<string | null> {
  const owner = await resolveUserEmail(request);
  if (!owner) return null;
  if (requested && requested.toLowerCase() !== owner.toLowerCase()) {
    return (await requireAdmin(request)) ? requested : null;
  }
  return owner;
}
