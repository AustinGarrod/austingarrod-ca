import { pageMetadata, profile, projects, type Project } from "@data/profile";

export type JsonLd = Record<string, unknown>;
export type SchemaPageType = "ProfilePage" | "CollectionPage" | "ContactPage" | "WebPage";

export const SITE_URL = "https://austingarrod.ca";
export const HOME_URL = `${SITE_URL}/`;
export const PERSON_ID = `${HOME_URL}#person`;
export const WEBSITE_ID = `${HOME_URL}#website`;
export const PROJECTS_ITEM_LIST_ID = `${SITE_URL}/projects/#itemlist`;

export const pageLastModified: Record<string, string> = {
  ...Object.fromEntries(Object.entries(pageMetadata).map(([path, metadata]) => [path, metadata.lastModified])),
  ...Object.fromEntries(projects.map((project) => [getProjectPath(project), project.lastModified]))
};

const breadcrumbLabels: Record<string, string> = {
  about: "About Austin Garrod",
  projects: "Projects",
  contact: "Contact Austin Garrod"
};

const knowsAbout = [
  "Full-stack engineering",
  "Frontend architecture",
  "Backend API development",
  "React",
  "Next.js",
  "Astro",
  "TypeScript",
  "Node.js",
  "React Native",
  "Kotlin Multiplatform",
  "MongoDB",
  "SQL",
  "Docker",
  "Static site deployment",
  "Software testing",
  "CI/CD",
  "Technical documentation"
];

export function getAbsoluteUrl(path: string) {
  return new URL(path, HOME_URL).toString();
}

export function getProjectPath(project: Project) {
  return `/projects/${project.slug}/`;
}

export function getProjectUrl(project: Project) {
  return getAbsoluteUrl(getProjectPath(project));
}

export function getProjectAnchor(project: Project) {
  return `/projects/#${project.slug}`;
}

export function getPageSchemaId(canonical: string) {
  return `${canonical}#webpage`;
}

export function getProjectSchemaId(project: Project) {
  return `${getProjectUrl(project)}#creativework`;
}

export function getProjectDescription(project: Project) {
  return project.summary;
}

export function createPersonSchema(): JsonLd {
  return {
    "@type": "Person",
    "@id": PERSON_ID,
    name: profile.name,
    url: HOME_URL,
    jobTitle: profile.title,
    email: `mailto:${profile.email}`,
    address: {
      "@type": "PostalAddress",
      addressRegion: "Ontario",
      addressCountry: "CA"
    },
    sameAs: [profile.github, profile.linkedin],
    knowsAbout
  };
}

export function createWebsiteSchema(): JsonLd {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: HOME_URL,
    name: profile.name,
    description: profile.seoDescription,
    inLanguage: "en-CA",
    publisher: {
      "@id": PERSON_ID
    }
  };
}

export function createWebPageSchema({
  canonical,
  title,
  description,
  schemaType,
  mainEntityId
}: {
  canonical: string;
  title: string;
  description: string;
  schemaType: SchemaPageType;
  mainEntityId?: string;
}): JsonLd {
  const schema: JsonLd = {
    "@type": schemaType,
    "@id": getPageSchemaId(canonical),
    url: canonical,
    name: title,
    description,
    isPartOf: {
      "@id": WEBSITE_ID
    },
    about: {
      "@id": PERSON_ID
    },
    inLanguage: "en-CA"
  };

  if (schemaType === "ProfilePage") {
    schema.mainEntity = {
      "@id": PERSON_ID
    };
  }

  if (mainEntityId) {
    schema.mainEntity = {
      "@id": mainEntityId
    };
  }

  return schema;
}

export function createBreadcrumbSchema(pathname: string, currentPageLabel?: string): JsonLd | null {
  const segments = pathname.replace(/^\/|\/$/g, "").split("/").filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  const itemListElement = [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: HOME_URL
    }
  ];

  let path = "/";

  segments.forEach((segment, index) => {
    path += `${segment}/`;
    const isCurrentPage = index === segments.length - 1;
    const label =
      isCurrentPage && currentPageLabel
        ? currentPageLabel
        : breadcrumbLabels[segment] ?? segment.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

    itemListElement.push({
      "@type": "ListItem",
      position: index + 2,
      name: label,
      item: getAbsoluteUrl(path)
    });
  });

  return {
    "@type": "BreadcrumbList",
    "@id": `${getAbsoluteUrl(pathname)}#breadcrumb`,
    itemListElement
  };
}

export function createBaseJsonLdGraph({
  canonical,
  pathname,
  title,
  description,
  schemaType,
  breadcrumbLabel,
  mainEntityId
}: {
  canonical: string;
  pathname: string;
  title: string;
  description: string;
  schemaType: SchemaPageType;
  breadcrumbLabel?: string;
  mainEntityId?: string;
}) {
  const breadcrumb = createBreadcrumbSchema(pathname, breadcrumbLabel);

  return [
    createPersonSchema(),
    createWebsiteSchema(),
    createWebPageSchema({
      canonical,
      title,
      description,
      schemaType,
      mainEntityId
    }),
    ...(breadcrumb ? [breadcrumb] : [])
  ];
}

export function createProjectCreativeWorkSchema(project: Project): JsonLd {
  const sameAs = [project.href, project.source].filter((url): url is string => Boolean(url));
  const abstract = project.caseStudySections
    .map((section) => `${section.title}: ${section.points.join(" ")}`)
    .join(" ");

  return {
    "@type": "CreativeWork",
    "@id": getProjectSchemaId(project),
    name: project.title,
    alternateName: project.label,
    description: project.summary,
    abstract,
    url: getProjectUrl(project),
    creator: {
      "@id": PERSON_ID
    },
    author: {
      "@id": PERSON_ID
    },
    keywords: project.stack.join(", "),
    about: project.stack.map((item) => ({
      "@type": "Thing",
      name: item
    })),
    mainEntityOfPage: {
      "@id": getPageSchemaId(getProjectUrl(project))
    },
    isPartOf: {
      "@id": WEBSITE_ID
    },
    ...(sameAs.length > 0 ? { sameAs } : {})
  };
}

export function createProjectsItemListSchema(selectedProjects: Project[] = projects): JsonLd {
  return {
    "@type": "ItemList",
    "@id": PROJECTS_ITEM_LIST_ID,
    name: `${profile.name} full-stack engineering projects`,
    itemListElement: selectedProjects.map((project, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: getProjectUrl(project),
      item: {
        "@id": getProjectSchemaId(project),
        name: project.title
      }
    }))
  };
}

export function createProjectsStructuredData(selectedProjects: Project[] = projects) {
  return [createProjectsItemListSchema(selectedProjects), ...selectedProjects.map(createProjectCreativeWorkSchema)];
}
