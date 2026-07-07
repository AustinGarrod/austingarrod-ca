export type Project = {
  title: string;
  label: string;
  summary: string;
  details: string[];
  stack: string[];
  status: "Public" | "Private case study" | "Archived public";
  visual: "open-design" | "cadence" | "spools" | "charity" | "nfc" | "civic" | "campaign";
  icon: "blocks" | "radio" | "database" | "cpu" | "map" | "globe" | "layers";
  href?: string;
  source?: string;
};

export const profile = {
  name: "Austin Garrod",
  title: "Senior Full Stack Developer",
  location: "Port Perry, Ontario, Canada",
  email: "austin.r.garrod@gmail.com",
  github: "https://github.com/AustinGarrod",
  linkedin: "https://www.linkedin.com/in/austingarrod",
  resume: "/austin-garrod-resume.pdf",
  availability: "Open to thoughtful engineering conversations",
  tagline:
    "Building resilient, scalable web applications from database architecture to frontend UI.",
  intro:
    "Senior full-stack developer with a background that spans product engineering, technical education, project management, civic technology, and practical home-lab systems. I like software that is clear to operate, easy to reason about, and calm under pressure.",
  seoDescription:
    "Austin Garrod is a senior full-stack developer in Ontario building maintainable web, mobile, API, and data systems with React, Next.js, TypeScript, Node.js, Kotlin Multiplatform, and modern databases."
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
    value: "CAPM",
    label: "PMI credential",
    description: "Issued Apr 2018; LinkedIn lists expiry Apr 2026."
  }
];

export const skills = [
  {
    title: "Frontend engineering",
    summary:
      "React, Next.js, TypeScript, state management, accessible interfaces, and component systems that stay maintainable as product scope grows.",
    items: ["React", "Next.js", "TypeScript", "React Native", "Redux", "Tailwind CSS"]
  },
  {
    title: "Backend and data",
    summary:
      "API systems with relational and document databases, queues, realtime dashboards, rate-limited workers, and service integrations.",
    items: ["Node.js", "Express", "MongoDB", "SQL", "Socket.IO", "BullMQ"]
  },
  {
    title: "Native and platform work",
    summary:
      "Pragmatic native-adjacent systems across Kotlin Multiplatform, Android tooling, C#/.NET, Python, Docker, and local device integrations.",
    items: ["Kotlin", "Android", "C#/.NET", "Python", "Docker", "MQTT"]
  },
  {
    title: "Project leadership",
    summary:
      "A blend of agile delivery, traditional project management, SDLC teaching experience, mentoring, estimates, and legacy-system stewardship.",
    items: ["Agile", "SDLC", "Mentorship", "Project estimates", "Documentation", "Troubleshooting"]
  }
];

export const experience = [
  {
    role: "Senior Full Stack Developer",
    organization: "Epilogue",
    dates: "Aug 2021 - Present",
    location: "Toronto, Ontario, Canada - Remote",
    summary:
      "Senior product engineering work across modern full-stack surfaces, with React and Next.js highlighted on LinkedIn.",
    bullets: [
      "Build and maintain production web application features across front-end and API boundaries.",
      "Work remotely with product and engineering teams on maintainable, user-facing software.",
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
    title: "Open Design",
    label: "Agentic design workspace",
    summary:
      "A public TypeScript-heavy codebase for an agent-native design workspace with desktop, web, plugin, and export surfaces.",
    details: [
      "Positioned around local-first design generation, agent integrations, plugin workflows, and multi-format artifact export.",
      "Useful public proof of comfort in a large TypeScript application with web, desktop, automation, and documentation surfaces."
    ],
    stack: ["TypeScript", "Next.js", "Electron", "Node", "CSS", "Python"],
    status: "Public",
    visual: "open-design",
    icon: "blocks",
    href: "https://open-design.ai",
    source: "https://github.com/AustinGarrod/open-design"
  },
  {
    title: "Cadence",
    label: "Minimalist podcast player",
    summary:
      "A private Kotlin Multiplatform podcast app with local-first state, opt-out diagnostics, and Pocket Casts import support.",
    details: [
      "Designed around no accounts, no first-party backend, and on-device application state.",
      "Includes Android build/test guidance, privacy documentation, Sentry diagnostics, and idempotent import behavior."
    ],
    stack: ["Kotlin Multiplatform", "Android", "Swift", "Sentry", "PowerShell"],
    status: "Private case study",
    visual: "cadence",
    icon: "radio"
  },
  {
    title: "Spools",
    label: "Filament inventory with AMS integration",
    summary:
      "A local web app for tracking 3D printer filament inventory with Bambu Lab AMS data sync over local MQTT.",
    details: [
      "Tracks spool material, color, weight, RFID tags, and manual entries for non-Bambu filament.",
      "Ships as a Docker-friendly TypeScript app with SQLite persistence and a React/Vite client."
    ],
    stack: ["React", "TypeScript", "Express", "SQLite", "MQTT", "Docker"],
    status: "Private case study",
    visual: "spools",
    icon: "layers"
  },
  {
    title: "Charity Data Scraper",
    label: "Resumable Canadian charity data pipeline",
    summary:
      "A full-stack scraper for charitydata.ca with queue-based processing, live progress, retries, and MongoDB storage.",
    details: [
      "Uses BullMQ and Redis for pause/resume control, retry handling, and rate-limited scraping.",
      "Includes a WebSocket dashboard, raw JSON storage, processed MongoDB records, and search views."
    ],
    stack: ["Node.js", "TypeScript", "React", "MongoDB", "Redis", "Docker"],
    status: "Private case study",
    visual: "charity",
    icon: "database"
  },
  {
    title: "Kids TV Controller",
    label: "NFC household media controller",
    summary:
      "A private household system for letting kids select shows by tapping NFC cards, with parental controls and a programming dashboard.",
    details: [
      "Combines an Express API, React/MUI dashboard, Plex library logic, Chromecast control, and TV power control concepts.",
      "Includes hardware planning for ESP32, PN532 NFC reader, NTAG215 cards, buttons, LEDs, and a printed enclosure."
    ],
    stack: ["React", "TypeScript", "Express", "MUI", "ESP32", "NFC"],
    status: "Private case study",
    visual: "nfc",
    icon: "cpu"
  },
  {
    title: "Honour Our Veterans Banner Platform",
    label: "Civic web, API, and mobile apps",
    summary:
      "Archived public React, Express, and React Native applications supporting the Uxbridge Honour Our Veterans Banner Program.",
    details: [
      "Built around public banner map experiences and program administration needs.",
      "Reflects a mix of web, API, mobile, and community-oriented software work."
    ],
    stack: ["React", "React Native", "Express", "TypeScript", "JavaScript"],
    status: "Archived public",
    visual: "civic",
    icon: "map",
    source: "https://github.com/AustinGarrod/Banner-Map-Web"
  },
  {
    title: "Campaign Static Site",
    label: "Astro site for municipal campaign content",
    summary:
      "A private Astro campaign site with static pages, React islands, design system work, and cPanel-friendly production concerns.",
    details: [
      "Uses Astro for zero-JS static output by default and React where interactive components are useful.",
      "Organizes page copy, forms, theme definitions, and deployment notes for a content-heavy civic site."
    ],
    stack: ["Astro", "React", "TypeScript", "MUI", "Static hosting"],
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
