'use client';

import { useEffect, useState } from 'react';

/**
 * A fixed dot per section down the right edge, lighting whichever section crosses the middle of
 * the viewport. Labels stay hidden until you hover the rail, so at rest it is four dots and no
 * chrome.
 *
 * The `-50% 0px -50% 0px` margin collapses the observer's root to a single line through the
 * viewport's midpoint, which is what makes "the current section" unambiguous — with a normal root
 * two sections are usually both intersecting and the highlight flickers between them.
 */
export function SectionRail({
  sections,
}: {
  sections: { id: string; label: string }[];
}) {
  const [active, setActive] = useState(sections[0]?.id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: '-50% 0px -50% 0px' },
    );

    for (const section of sections) {
      const node = document.getElementById(section.id);
      if (node) observer.observe(node);
    }

    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav
      aria-label="Sections"
      className="group/rail fixed top-1/2 right-6 z-40 hidden -translate-y-1/2 flex-col gap-3 lg:flex motion-reduce:hidden"
    >
      {sections.map((section) => {
        const on = active === section.id;
        return (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="flex items-center justify-end gap-2"
          >
            <span
              className={`ease-brand font-mono text-[10px] tracking-[0.08em] uppercase transition-all duration-300 ${
                on
                  ? 'text-foreground opacity-100'
                  : 'text-muted-foreground opacity-0 group-hover/rail:opacity-100'
              }`}
            >
              {section.label}
            </span>
            <span
              className={`ease-brand size-1.5 rounded-full transition-all duration-300 ${
                on ? 'scale-125 bg-foreground' : 'bg-muted-foreground/40'
              }`}
            />
          </a>
        );
      })}
    </nav>
  );
}
