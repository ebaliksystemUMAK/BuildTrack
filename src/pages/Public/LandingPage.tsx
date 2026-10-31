import type { Page } from "../../App"
import landingImage from "../../assets/valencia/landing.png"
import processAction from "../../assets/valencia/process-action.png"
import processSteps from "../../assets/valencia/process-steps.png"
import Header from "../../components/Header"
import Icon from "../../components/Icons"
import PublicFooter from "../../components/PublicFooter"
import { handlePublicNavigation, usePublicHashScroll } from "../../lib/publicNavigation"

type LandingPageProps = { navigate: (page: Page) => void }

const servicePhotos = [
  "https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=900&q=80",
]

const values = [
  ["Integrity", "Honest reporting mapped directly to blueprint milestones."],
  ["Innovation", "Pioneering real-time site analytics and smart tracking."],
  ["Quality", "Structural verification backed by multi-point digital checks."],
  ["Safety", "Biometric access monitoring to verify qualified operators."],
]

const benefits = [
  [
    "eye",
    "Project Monitoring",
    "Live operational control centers providing granular progress reporting on site milestones.",
  ],
  [
    "shield",
    "Quality Assurance",
    "Automated QA logs with strict verification protocols directly mapped to CAD plans.",
  ],
  [
    "people",
    "Workforce Tracking",
    "Secure biometric attendance systems eliminating manual scheduling leakage.",
  ],
  [
    "blueprint",
    "Blueprint-Based Progress",
    "Layer completion can be verified over 2D blueprint information for absolute clarity.",
  ],
  [
    "chart",
    "Transparent Client Reporting",
    "Generate secure, shareable dashboards to keep project investors aligned.",
  ],
  [
    "building",
    "Real-Time Activity Monitoring",
    "Immediate alerts, zone operations updates, and workforce status tracking.",
  ],
] as const

const processCards = [
  {
    title: "Careful Review of Project Plans",
    description:
      "A thorough review of engineering drawings and specifications ensures accuracy, feasibility, and compliance before construction begins.",
    image: processSteps,
    imagePosition: "0% 0%",
    imageSize: "300% auto",
  },
  {
    title: "Aligning the Team Before Execution",
    description:
      "The project team aligns on scope, safety requirements, responsibilities, and timelines before work begins.",
    image: processSteps,
    imagePosition: "50% 0%",
    imageSize: "300% auto",
  },
  {
    title: "United, Prepared, and Ready to Build",
    description:
      "A unified workforce begins operations with clear direction, proper coordination, and a shared commitment to quality and safety.",
    image: processSteps,
    imagePosition: "100% 0%",
    imageSize: "300% auto",
  },
  {
    title: "Putting the Plan into Motion",
    description:
      "Mobilized personnel turn the approved plan into coordinated construction activity with safe, deliberate execution.",
    image: processAction,
    imagePosition: "50% 0%",
    imageSize: "100% auto",
  },
] as const

export default function LandingPage({ navigate }: LandingPageProps) {
  usePublicHashScroll()
  return (
    <div className="landing">
      <Header navigate={navigate} />

      <main>
        <section
          className="hero"
          style={{
            backgroundImage: `linear-gradient(90deg, rgba(9,9,11,.86), rgba(9,9,11,.25)), url(${landingImage})`,
          }}
        >
          <div className="hero__content">
            <div className="eyebrow">Integrated construction intelligence</div>
            <h1>Integrated progress, QA & biometric workforce system</h1>
            <p>
              Drive execution precision. BuildTrack maps physical construction
              progress directly to 2D blueprints, automates site compliance
              QC checklists, and registers real-time biometric tracking across
              projects.
            </p>
            <div className="hero__actions">
              <button
                className="button button--gold"
                onClick={() => navigate("register")}
              >
                Get started now <span>→</span>
              </button>
              <a className="button button--outline-light" href="#features">
                Explore blueprints
              </a>
            </div>
            <div className="hero__stats">
              <div>
                <strong>7+</strong>
                <span>Years of technical leadership</span>
              </div>
              <div>
                <strong>100%</strong>
                <span>Blueprint-to-site integrity</span>
              </div>
              <div>
                <strong>Zero</strong>
                <span>Biometric attendance leakage</span>
              </div>
            </div>
          </div>
        </section>

        <section className="section section--soft" id="about">
          <div className="about-grid">
            <div className="section-copy">
              <div className="eyebrow">About Valencia</div>
              <h2>A Trusted Leader in Construction Engineering</h2>
              <p>
                Valencia Construction Services is a trusted service entity
                specializing in end-to-end project development. Every project we
                undertake — ranging from civil works and structural projects to
                architectural fit-out works — is executed with precision, strict
                adherence to safety standards, and a commitment to client
                satisfaction.
              </p>
              <a className="button" href="/valencia" onClick={event => handlePublicNavigation(event, "/valencia", navigate)} style={{ background: "var(--purple)", color: "white", marginTop: 12, textTransform: "none" }}>Get to know Valencia <span aria-hidden="true">↗</span></a>
            </div>
            <article className="mission-card">
              <span>Our mission</span>
              <p>
                To give every client and partner confidence through meticulous
                site management, accountability, and visibility.
              </p>
            </article>
            <article className="vision-card">
              <span>Our vision</span>
              <p>
                To be a trusted engineering construction and consulting
                enterprise delivering exceptional solutions.
              </p>
            </article>
          </div>
          <div className="values-grid">
            {values.map(([title, text], index) => (
              <article className="value-card" key={title}>
                <span className="value-card__number">0{index + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section" id="services">
          <div className="section-heading">
            <div className="eyebrow">Expertise in execution</div>
            <h2>Our Specialized Core Services</h2>
          </div>
          <div className="services-grid">
            {[
              [
                "Structural Engineering",
                "High-strength steel frameworks, structural integrity analysis, seismic evaluation & retrofitting.",
              ],
              [
                "Civil Works",
                "Master earthworks & utilities, storm drainage infrastructure, pavement & road network construction.",
              ],
              [
                "Architectural Design",
                "High-detail interior planning, photorealistic 3D visualizations, sustainable building envelopes.",
              ],
            ].map(([title, description], index) => (
              <article className="service-card" key={title}>
                <img src={servicePhotos[index]} alt="" />
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  <a href="#contact">
                    Learn more <span>→</span>
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="section process-section">
          <div className="section-heading">
            <div className="eyebrow">From blueprint to build</div>
            <h2>Project Development Process</h2>
            <p>
              Every successful build begins with careful review, clear team
              alignment, and safe, coordinated execution.
            </p>
          </div>
          <div className="process-gallery">
            {processCards.map((card) => (
              <article className="process-card" key={card.title}>
                <div
                  className="process-card__image"
                  role="img"
                  aria-label={card.title}
                  style={{
                    backgroundImage: `url(${card.image})`,
                    backgroundPosition: card.imagePosition,
                    backgroundSize: card.imageSize,
                  }}
                />
                <div className="process-card__body">
                  <h3>{card.title}</h3>
                  <p>{card.description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="section section--dark">
          <div className="section-heading section-heading--light">
            <div className="eyebrow">Engineered advantage</div>
            <h2>Why Choose BuildTrack</h2>
          </div>
          <div className="benefits-grid">
            {benefits.map(([icon, title, description]) => (
              <article className="benefit-card" key={title}>
                <span className="benefit-card__icon">
                  <Icon name={icon} />
                </span>
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="section capabilities" id="features">
          <div className="section-heading">
            <div className="eyebrow">BuildTrack features</div>
            <h2>System Capabilities Built for High-Density Operations</h2>
          </div>
          <div className="feature-row">
            <div className="blueprint-demo">
              <span className="plan-title">
                QA-4 / Ground Floor • Live Tracking
              </span>
              <div className="plan-grid">
                <span className="pin pin--one">Living Area • 90%</span>
                <span className="pin pin--two">MEP • 72%</span>
                <span className="pin pin--three">Inspection • Due</span>
              </div>
            </div>
            <div className="feature-copy">
              <h3>2D Blueprint Mapping</h3>
              <p>
                Superimpose exact progress updates directly onto digital floor
                plans. Real-time visual heatmaps allow project managers to
                understand layout progress, masonry advancement, and electrical
                routing in a single unified CAD viewer.
              </p>
            </div>
          </div>
          <div className="feature-row feature-row--reverse">
            <div className="feature-copy">
              <h3>Milestone & Progress Tracking</h3>
              <p>
                Break down vast construction projects into dynamic
                percentage-based milestones. BuildTrack links daily progress
                inputs to master schedules, alerting managers to deviations
                before delays impact the project budget.
              </p>
            </div>
            <div className="progress-panel">
              {[
                "Level 15 Foundation",
                "Core Structure Framing",
                "HVAC Duct Installation",
              ].map((label, index) => (
                <div className="progress-item" key={label}>
                  <div>
                    <span>{label}</span>
                    <strong>{[100, 78, 24][index]}%</strong>
                  </div>
                  <span className="progress-track">
                    <span style={{ width: `${[100, 78, 24][index]}%` }} />
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="biometric-card">
            <div className="avatar">ES</div>
            <div>
              <span>Verified access</span>
              <strong>Operator: Eduardo Santos</strong>
              <small>License: Crane Rigging Level III</small>
            </div>
            <div className="feature-copy">
              <h3>Biometric Attendance Integration</h3>
              <p>
                Eradicate scheduling issues and manual timekeeping. Secure
                on-site check-ins verify qualified, licensed crew members on
                critical tasks, ensuring total labor safety and compliance.
              </p>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter navigate={navigate} />
    </div>
  )
}
