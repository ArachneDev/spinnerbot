import { HomePage } from "./features/home/HomePage";
import { RosterPage } from "./features/roster/RosterPage";

const rosterToken = /^\/r\/([\w-]+)$/.exec(window.location.pathname)?.[1];

export function App() {
  return (
    <div className="app rc-grain">
      <header className="rc-header">
        <div className="rc-container rc-header__bar">
          <a className="rc-brand" href="/">
            <img src="/brand/spinner-bot-icon.jpg" alt="" />
            <span>
              <b>Spinner Bot</b>
              <small>WEAVE THE WEB // WAGE THE WAR</small>
            </span>
          </a>
        </div>
      </header>
      <main className="app-main">
        {rosterToken ? <RosterPage token={rosterToken} /> : <HomePage />}
      </main>
      <footer className="rc-footer">
        <div className="rc-container rc-footer__grid">
          <div className="actions">
            <img src="/brand/arachne-crest.png" alt="Arachne crest" width={64} height={64} />
            <div>
              <span className="rc-stencil">ARACHNE</span>
              <p className="rc-label">WEAVE THE WEB // WAGE THE WAR</p>
            </div>
          </div>
          <div className="rc-footer__legal">
            <span>[RCNE] // WARDOGS COMPETITIVE UNIT</span>
            <span>INDEPENDENT CLAN. UNITED BY THE WEB.</span>
            <span>
              Privacy: Spinner Bot keeps Discord user IDs and Steam links for rosters and
              /join-lobby. Rosters are deleted when they expire. Ask a Wardogs admin to delete your
              data; copies stay in backups until old snapshots rotate out, which can take a long
              time.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
