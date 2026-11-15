import { Flow } from "@/components/flow";
import { Hero } from "@/components/hero/hero";
import { RevealObserver } from "@/components/reveal-observer";
import { FinalCta, Footer, Nav } from "@/components/site-chrome";
import { Thread } from "@/components/thread";
import { UseCases } from "@/components/use-cases";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <section className="relative pb-24 md:pb-32">
          <Thread
            label="How it works"
            title="From a message to a merged fix."
            body="Something gets reported, agentcall picks the right agent, and the result lands back where it started."
          />
          <div className="mt-14 md:mt-20">
            <Flow />
          </div>
        </section>
        <section className="relative pb-24 md:pb-32">
          <Thread
            label="In your Slack"
            title="They work where your team already talks."
            body="Security reports, bugs, quick questions. Agents reply in the thread like everyone else."
          />
          <div className="mt-14 md:mt-16">
            <UseCases />
          </div>
        </section>
        <Thread label="Get started" />
        <FinalCta />
      </main>
      <Footer />
      <RevealObserver />
    </>
  );
}
