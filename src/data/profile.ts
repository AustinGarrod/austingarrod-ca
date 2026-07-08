export type Project = {
  slug: string;
  title: string;
  label: string;
  summary: string;
  details: string[];
  stack: string[];
  status: "Public" | "Private case study" | "Archived public";
  visual: "portfolio" | "cadence" | "spools" | "charity" | "nfc" | "civic" | "campaign";
  icon: "blocks" | "radio" | "database" | "cpu" | "map" | "globe" | "layers";
  href?: string;
  source?: string;
};

export const profile = {
  name: "Austin Garrod",
  title: "Senior Full Stack Developer",
  location: "Ontario, Canada",
  email: "austin.r.garrod@gmail.com",
  github: "https://github.com/AustinGarrod",
  linkedin: "https://www.linkedin.com/in/austingarrod",
  resume: "/austin-garrod-resume.pdf",
  availability: "Open to thoughtful engineering conversations",
  tagline:
    "Building resilient, scalable web applications from database architecture to frontend UI.",
  intro:
    "Senior full-stack developer with a background that spans production software, technical education, project management, civic technology, and practical home-lab systems. I like modern development practices that make software easier to change: typed interfaces, useful tests, observable systems, clear documentation, and pragmatic AI-assisted workflows that keep the reasoning visible.",
  seoDescription:
    "Austin Garrod is a senior full-stack developer in Ontario building maintainable React, Next.js, TypeScript, Node.js, mobile, API, and data systems."
};

export const highlights = [
  {
    value: "5+",
    label: "Years at Epilogue",
    description: "Current senior full-stack role, remote from Ontario."
  },
  {
    value: "React",
    label: "Product UI",
    description: "Front-end systems across React, React Native, and Next.js."
  },
  {
    value: "Node",
    label: "API systems",
    description: "Express, databases, queues, realtime updates, and integrations."
  },
  {
    value: "AI",
    label: "Modern practice",
    description: "Pragmatic AI-assisted workflows, typed systems, tests, and clear documentation."
  }
];

export const skills = [
  {
    title: "Frontend engineering",
    summary:
      "React, Next.js, TypeScript, state management, accessible interfaces, and component systems that stay maintainable as product scope grows.",
    items: ["React", "Next.js", "TypeScript", "React Native", "Redux", "Accessibility"]
  },
  {
    title: "Backend and data",
    summary:
      "API systems with relational and document databases, background processing, live progress surfaces, rate-limited workers, and service integrations.",
    items: ["Node.js", "Express", "MongoDB", "SQL", "Redis", "REST APIs"]
  },
  {
    title: "Native and platform work",
    summary:
      "Pragmatic native-adjacent systems across Kotlin Multiplatform, Android tooling, C#/.NET, Python, Docker, and local device integrations.",
    items: ["Kotlin", "Android", "C#/.NET", "Python", "Docker", "MQTT"]
  },
  {
    title: "Engineering practice",
    summary:
      "A practical blend of AI-assisted development, code review, CI/CD, SDLC teaching experience, mentoring, estimates, and legacy-system stewardship.",
    items: ["AI workflows", "Code review", "CI/CD", "SDLC", "Documentation", "Mentorship"]
  }
];

export const experience = [
  {
    role: "Senior Full Stack Developer",
    organization: "Epilogue",
    dates: "Aug 2021 - Present",
    location: "Toronto, Ontario, Canada - Remote",
    summary:
      "Senior full-stack work across production web application surfaces with React, Next.js, APIs, and databases.",
    bullets: [
      "Build and maintain production web application features across front-end and API boundaries.",
      "Work remotely with teammates and stakeholders on maintainable, user-facing software.",
      "Apply TypeScript, React, Next.js, API development, and database experience to practical product work."
    ]
  },
  {
    role: "Lead Full-stack Developer",
    organization: "Tidal",
    dates: "Apr 2021 - Jul 2021",
    location: "Richmond Hill, Ontario, Canada",
    summary:
      "Led front-end development, upkeep, and management of corporate web applications across multiple industries.",
    bullets: [
      "Worked with major retail brands on worldwide Shopify stores across front-end and back-end maintenance.",
      "Coordinated external and internal developers to deliver customer and internal software projects.",
      "Reviewed project proposals and estimates while maintaining and extending legacy codebases."
    ]
  },
  {
    role: "Professor, Computer Programming and Project Management",
    organization: "Durham College",
    dates: "May 2018 - Apr 2021",
    location: "Oshawa, Ontario, Canada",
    summary:
      "Developed and taught courses in web development, Windows application development, modern JavaScript, and project management.",
    bullets: [
      "Mentored students and alumni on software development choices for early-stage businesses.",
      "Created and maintained online course material focused on practical programming and SDLC fundamentals.",
      "Taught troubleshooting and independent problem-solving as core engineering habits."
    ]
  },
  {
    role: "Freelancer",
    organization: "Austin Garrod",
    dates: "May 2017 - Apr 2021",
    location: "Ontario, Canada",
    summary:
      "Designed and created branded web presences, CMS implementations, and social media presences for organizations.",
    bullets: [
      "Built web experiences with React, Meteor, and established web standards.",
      "Implemented and maintained distributed CMS installations and custom content-management tools.",
      "Helped organizations grow customer and member communication through web and social channels."
    ]
  },
  {
    role: "Research Specialist",
    organization: "Durham College, ORSIE",
    dates: "Aug 2016 - Apr 2017",
    location: "Oshawa, Ontario, Canada",
    summary:
      "Worked on applied research systems including React/Node vehicle analytics, iOS item tracking, and responsive Meteor applications.",
    bullets: [
      "Contributed to a vehicle analytics web application for dealership communication workflows.",
      "Designed and helped develop an iOS application for tracking items and at-risk people.",
      "Reworked a Meteor web app to improve accessibility across devices for senior users."
    ]
  }
];

export const projects: Project[] = [
  {
    slug: "austingarrod-ca",
    title: "AustinGarrod.ca",
    label: "Static portfolio and deployment system",
    summary:
      "A static Astro portfolio built for cPanel hosting, with typed content data, generated resume and social assets, and a PHP contact endpoint.",
    details: [
      "Keeps the public site portable: static pages, no server-side Node dependency, and a contact path that still works on basic shared hosting.",
      "Centralizes profile, navigation, skills, experience, and project copy in typed data so public pages, SEO metadata, and case studies stay consistent.",
      "Generates the Open Graph image and resume PDF from source-controlled scripts, reducing manual asset drift when project or experience copy changes.",
      "Uses a strict design system, GitHub Actions checks, and deployment notes for a low-maintenance professional site that can be rebuilt locally or in CI."
    ],
    stack: ["Astro", "TypeScript", "PHP", "Python", "GitHub Actions", "Static hosting"],
    status: "Public",
    visual: "portfolio",
    icon: "globe",
    href: "https://github.com/AustinGarrod/austingarrod-ca"
  },
  {
    slug: "cadence",
    title: "Cadence",
    label: "Minimalist podcast player",
    summary:
      "A private Kotlin Multiplatform podcast app with local-first state, opt-out diagnostics, and Pocket Casts import support.",
    details: [
      "Designed around no accounts, no first-party backend, and on-device application state.",
      "Models subscriptions, episodes, playback state, and import history in a way that keeps the app useful offline and recoverable after interrupted imports.",
      "Treats diagnostics as an explicit opt-out surface, with privacy documentation and Sentry configuration kept visible in the project structure.",
      "Includes Android build/test guidance, device-harness workflows, and idempotent Pocket Casts import behavior for repeatable local validation."
    ],
    stack: ["Kotlin Multiplatform", "Android", "Swift", "Sentry", "PowerShell"],
    status: "Private case study",
    visual: "cadence",
    icon: "radio"
  },
  {
    slug: "spools",
    title: "Spools",
    label: "Filament inventory with AMS integration",
    summary:
      "A local web app for tracking 3D printer filament inventory with Bambu Lab AMS data sync over local MQTT.",
    details: [
      "Tracks spool material, color, weight, RFID tags, and manual entries for non-Bambu filament.",
      "Separates machine-synced AMS state from manually curated inventory so automatic updates do not overwrite real-world corrections.",
      "Provides dashboard views for remaining material, loaded trays, spool metadata, and operational checks before long prints.",
      "Ships as a Docker-friendly TypeScript app with SQLite persistence, an Express API, and a React/Vite client designed for local network use."
    ],
    stack: ["React", "TypeScript", "Express", "SQLite", "MQTT", "Docker"],
    status: "Private case study",
    visual: "spools",
    icon: "layers"
  },
  {
    slug: "charity-data-scraper",
    title: "Charity Data Scraper",
    label: "Resumable Canadian charity data pipeline",
    summary:
      "A full-stack scraper for public Canadian charity records with queue-based processing, live progress, retries, and MongoDB storage.",
    details: [
      "Uses Redis-backed job state for pause/resume control, retry handling, and rate-limited collection across a large public-record dataset.",
      "Stores raw JSON responses separately from processed MongoDB records so parsing logic can be rerun without re-fetching every source record.",
      "Includes a live progress dashboard, queue visibility, search views, and operational controls for long-running scrape sessions.",
      "Keeps the case study intentionally generic, focusing on pipeline architecture without naming the source site or exposing brittle scraping details."
    ],
    stack: ["Node.js", "TypeScript", "React", "MongoDB", "Redis", "Docker"],
    status: "Private case study",
    visual: "charity",
    icon: "database"
  },
  {
    slug: "kids-tv-controller",
    title: "Kids TV Controller",
    label: "NFC household media controller",
    summary:
      "A private household system for letting kids select shows by tapping NFC cards, with parental controls and a programming dashboard.",
    details: [
      "Combines an Express API, React/MUI dashboard, Plex library logic, Chromecast control, and TV power control concepts.",
      "Maps physical cards to approved media choices so the interaction can stay simple for children while configuration remains controlled by adults.",
      "Plans for device states such as idle, card detected, casting, blocked, and error feedback through buttons, LEDs, and dashboard status.",
      "Includes hardware planning for ESP32, PN532 NFC reader, NTAG215 cards, physical controls, and a printed enclosure."
    ],
    stack: ["React", "TypeScript", "Express", "MUI", "ESP32", "NFC"],
    status: "Private case study",
    visual: "nfc",
    icon: "cpu"
  },
  {
    slug: "honour-our-veterans-banner-platform",
    title: "Honour Our Veterans Banner Platform",
    label: "Civic web, API, and mobile apps",
    summary:
      "Archived public React, Express, and React Native applications supporting the Uxbridge Honour Our Veterans Banner Program.",
    details: [
      "Built around public banner map experiences, searchable veteran records, and program administration needs for a community initiative.",
      "Connected web, API, and mobile surfaces so public browsing and internal maintenance could share one underlying project model.",
      "Represents earlier full-stack civic work with React, Express, TypeScript/JavaScript, and React Native across multiple deployable apps.",
      "Kept as an archived public reference to show the engineering shape while avoiding claims that the original program infrastructure is currently maintained."
    ],
    stack: ["React", "React Native", "Express", "TypeScript", "JavaScript"],
    status: "Archived public",
    visual: "civic",
    icon: "map",
    source: "https://github.com/AustinGarrod/Banner-Map-Web"
  },
  {
    slug: "campaign-static-site",
    title: "Campaign Static Site",
    label: "Astro site for municipal campaign content",
    summary:
      "A private Astro campaign site deployed to Netlify, with static pages, React islands, design system work, and form-friendly production concerns.",
    details: [
      "Uses Astro for zero-JS static output by default and React where interactive components are useful.",
      "Deploys through Netlify with a production path aligned around static hosting, deploy previews, and environment-managed form handling.",
      "Organizes page copy, forms, theme definitions, metadata, and reusable content sections for a content-heavy civic site.",
      "Balances campaign-specific messaging with reusable implementation patterns so pages can be revised quickly without reworking the layout system."
    ],
    stack: ["Astro", "React", "TypeScript", "MUI", "Netlify"],
    status: "Private case study",
    visual: "campaign",
    icon: "globe"
  }
];

export const siteNav = [
  { href: "/", label: "Home" },
  { href: "/about/", label: "About" },
  { href: "/projects/", label: "Projects" },
  { href: "/contact/", label: "Contact" }
];
