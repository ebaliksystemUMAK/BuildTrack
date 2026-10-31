import type { Page } from "../App"
import { handlePublicNavigation } from "../lib/publicNavigation"
import Brand from "./Brand"
import Icon from "./Icons"

type PublicFooterProps = {
  navigate: (page: Page, hash?: string) => void
  page?: "buildtrack" | "valencia"
}

export default function PublicFooter({ navigate, page = "buildtrack" }: PublicFooterProps) {
  const isValencia = page === "valencia"
  const section = (id: string) => isValencia ? `/valencia#valencia-${id}` : `/buildtrack#${id}`
  const links = [
    { label: "Valencia Construction Services", href: "/valencia" },
    { label: "About Us", href: section("about") },
    { label: "Our Services", href: section("services") },
    { label: "Platform Features", href: "/buildtrack#features" },
    { label: "Contact Page", href: section("contact") },
  ]

  return (
    <footer className={`site-footer${isValencia ? " site-footer--neutral" : ""}`} id={isValencia ? undefined : "contact"}>
      <div className="site-footer__grid">
        <div className="footer-intro">
          <Brand inverse />
          <p>
            BuildTrack delivers site intelligence. Mapped progress, simplified
            inspections, automated compliance, and real-time labor security in
            a single application.
          </p>
          <div className="social-links" aria-label="Social media">
            <a href="#" aria-label="Facebook">f</a>
            <a href="#" aria-label="LinkedIn">in</a>
            <a href="#" aria-label="Instagram">◎</a>
          </div>
        </div>
        <nav className="footer-column" aria-label="Footer navigation">
          <h3>Navigation</h3>
          {links.map(link => <a key={link.href} href={link.href} onClick={event => handlePublicNavigation(event, link.href, navigate)}>{link.label}</a>)}
        </nav>
        <div className="footer-column">
          <h3>Platform Services</h3>
          <span>Blueprint Overlays</span>
          <span>Task Progress</span>
          <span>Biometrics Hub</span>
          <span>Documentation API</span>
        </div>
        <div className="footer-column footer-contact">
          <h3>Contact Us</h3>
          <div>
            <span className="footer-contact__icon"><Icon name="phone" /></span>
            <p>
              <small>Phone support</small>
              <a href="tel:09971270773">09971270773</a> /{" "}
              <a href="tel:09104292842">09104292842</a>
            </p>
          </div>
          <div>
            <span className="footer-contact__icon"><Icon name="mail" /></span>
            <p>
              <small>Email queries</small>
              <a href="mailto:valenciaconstruction2019@gmail.com">valenciaconstruction2019@gmail.com</a>
            </p>
          </div>
          <div>
            <span className="footer-contact__icon"><Icon name="building" /></span>
            <p>
              <small>Office address</small>Block 31, Berlin St., Purok 8, Sta.
              Ana, Taytay, Rizal, 1920
            </p>
          </div>
        </div>
      </div>
      <div className="site-footer__bottom">
        <span>© 2025 Valencia Construction Services. All rights reserved.</span>
        <span>Privacy Policy &nbsp;&nbsp; Terms of Use</span>
      </div>
    </footer>
  )
}
