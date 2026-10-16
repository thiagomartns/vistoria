import { APP_NAME } from "@/shared/app";

export default function HomePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <h1 className="text-4xl font-semibold tracking-tight">{APP_NAME}</h1>
    </main>
  );
}
