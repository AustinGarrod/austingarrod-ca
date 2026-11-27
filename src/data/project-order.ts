import { projects, type Project } from "@data/profile";

const projectOrder = new Map([
  ["junkin-electric", -1],
  ["honour-our-veterans-banner-platform", 0],
  ["cadence", 1],
  ["idle-slayer-companion", 2],
  ["spools", 3],
  ["charity-data-scraper", 4],
  ["austingarrod-ca", 5],
  ["campaign-static-site", 6],
  ["kids-tv-controller", 7]
]);

const sortedProjects = [...projects].sort(
  (a, b) => (projectOrder.get(a.slug) ?? Number.MAX_SAFE_INTEGER) - (projectOrder.get(b.slug) ?? Number.MAX_SAFE_INTEGER)
);

/** Projects with a real screenshot, in display order. */
export const screenshotProjects = sortedProjects.filter((project) => project.visual === "screenshot" && project.screenshot);

/** The remaining case studies, in display order. */
export const otherProjects = sortedProjects.filter((project) => !screenshotProjects.includes(project));

/** Every project in the order the Projects page and its structured data list them. */
export const orderedProjects: Project[] = [...screenshotProjects, ...otherProjects];

/** The projects before and after this one in the Projects page order. */
export function neighbouringProjects(project: Project) {
  const index = orderedProjects.findIndex((item) => item.slug === project.slug);
  return {
    previous: index > 0 ? orderedProjects[index - 1] : undefined,
    next: index >= 0 && index < orderedProjects.length - 1 ? orderedProjects[index + 1] : undefined
  };
}

/** True when a project link points inside this site (for example a utility). */
export function isInternalHref(href: string) {
  return href.startsWith("/");
}
