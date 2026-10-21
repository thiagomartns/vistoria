import { AvisLockup } from "@/shared/components/avis-lockup";

export default function HomePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <h1>
        <AvisLockup layout="vertical" caption />
      </h1>
    </main>
  );
}
