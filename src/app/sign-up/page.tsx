import { redirect } from "next/navigation";

// 旧路由保留兼容:全局弹窗替换了独立的注册页。
export default async function SignUpPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const carry = new URLSearchParams();
  if (typeof query?.redirect === "string")
    carry.set("redirect", query.redirect);
  if (typeof query?.plan === "string")
    carry.set("plan", query.plan);
  if (typeof query?.ref === "string") carry.set("ref", query.ref);
  carry.set("auth", "sign-up");
  redirect(`/?${carry.toString()}`);
}
