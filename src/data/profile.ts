import profileData from "./profile.json";

export type ProjectStatus = "Public" | "Private case study" | "Archived public";
export type ProjectVisual = "portfolio" | "cadence" | "spools" | "charity" | "nfc" | "civic" | "campaign";
export type ProjectIcon = "blocks" | "radio" | "database" | "cpu" | "map" | "globe" | "layers";

export type Profile = {
  name: string;
  title: string;
  location: string;
  email: string;
  github: string;
  linkedin: string;
  resume: string;
  availability: string;
  tagline: string;
  intro: string;
  seoDescription: string;
};

export type PageMetadata = {
  lastModified: string;
};

export type Highlight = {
  value: string;
  label: string;
  description: string;
};

export type Skill = {
  title: string;
  summary: string;
  items: string[];
};

export type Experience = {
  role: string;
  organization: string;
  dates: string;
  location: string;
  summary: string;
  bullets: string[];
};

export type CaseStudySection = {
  title: string;
  points: string[];
};

export type Project = {
  slug: string;
  title: string;
  label: string;
  summary: string;
  details: string[];
  cardHighlights: string[];
  caseStudySections: CaseStudySection[];
  stack: string[];
  status: ProjectStatus;
  visual: ProjectVisual;
  icon: ProjectIcon;
  href?: string;
  source?: string;
  lastModified: string;
};

export type SiteNavItem = {
  href: string;
  label: string;
};

export type ProfileData = {
  profile: Profile;
  pageMetadata: Record<string, PageMetadata>;
  highlights: Highlight[];
  skills: Skill[];
  experience: Experience[];
  projects: Project[];
  siteNav: SiteNavItem[];
};

export const data = profileData as ProfileData;
export const { profile, pageMetadata, highlights, skills, experience, projects, siteNav } = data;
