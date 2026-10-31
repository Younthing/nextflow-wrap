import { redirect } from "next/navigation";

// The page only redirects, so there is no segment to validate for instant navigation.
export const instant = false;

export default function HomePage() {
  redirect("/workflows");
}
