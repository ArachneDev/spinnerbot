import { PageHeader, Ticker } from "../../components/PageHeader";

export function HomePage() {
  return (
    <>
      <Ticker
        items={[
          ["Command", "/build-roster"],
          ["Link", "Private // 24 hours"],
        ]}
      />
      <PageHeader kicker="Spinner Bot" title="One pack" sub="Assign the squads // Post the order">
        To build a roster, run <code>/build-roster</code> in Discord. Spinner Bot sends you a
        private link that opens your roster here.
      </PageHeader>
    </>
  );
}
