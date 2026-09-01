import type { ReactNode, SVGProps } from "react";

/**
 * PI's icon set — hand-drawn in a 24px box, one 1.5px stroke weight, always
 * `currentColor`. Drawn here rather than pulled from a library so the marks
 * match the stationery vocabulary (nib, timetable, paper plane) and so nothing
 * depends on a font that may not ship the glyph.
 *
 * Icons are decorative by default (`aria-hidden`). Pass a `title` when the icon
 * is the only label a control has; it renders a <title> and switches the node
 * to `role="img"`.
 */

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  /** Rendered edge length in px. */
  size?: number;
  /** Accessible name. Omit for icons that sit beside visible text. */
  title?: string;
};

function Icon({
  size = 18,
  title,
  children,
  ...rest
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/** Fountain-pen nib — writing, chat, compose. */
export function IconPen(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3c2.6 3.6 4.5 7.7 4.8 11.5L12 21l-4.8-6.5C7.5 10.7 9.4 6.6 12 3Z" />
      <path d="M12 11.4V17" />
      <circle cx="12" cy="9.7" r="1.05" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** A week timetable — the planner. */
export function IconGrid(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.2" />
      <path d="M3.5 9.2h17M9.2 9.2v10.3M14.8 9.2v10.3" />
    </Icon>
  );
}

/** A ticked-off line — done, confirmed. */
export function IconCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.6 12.4 9.2 17.6 19.6 6.2" />
    </Icon>
  );
}

/** Starred / pinned. */
export function IconStar(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m12 3.7 2.6 5.5 6 .85-4.35 4.2 1.05 5.95L12 17.35 6.7 20.2l1.05-5.95L3.4 10.05l6-.85L12 3.7Z" />
    </Icon>
  );
}

/** Clock face — timestamps, recency. */
export function IconClock(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.3V12l3.3 2" />
    </Icon>
  );
}

/** Magnifier — search. */
export function IconSearch(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.4 15.4 4.6 4.6" />
    </Icon>
  );
}

/** Plus — new chat, add. */
export function IconPlus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5.2v13.6M5.2 12h13.6" />
    </Icon>
  );
}

/** Arrow up — send, scroll to top. */
export function IconArrowUp(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 19.4V5.2M6.2 11 12 5.2 17.8 11" />
    </Icon>
  );
}

/** Filled square — stop a running turn. */
export function IconStop(props: IconProps) {
  return (
    <Icon {...props}>
      <rect
        x="6.8"
        y="6.8"
        width="10.4"
        height="10.4"
        rx="2.4"
        fill="currentColor"
        stroke="none"
      />
    </Icon>
  );
}

/** Leaves the app — links out to a TigerApp. */
export function IconExternal(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 4.6h5.4V10" />
      <path d="M19.4 4.6 11.2 12.8" />
      <path d="M16.6 14.2v4.3a1.9 1.9 0 0 1-1.9 1.9H5.5a1.9 1.9 0 0 1-1.9-1.9V9.3a1.9 1.9 0 0 1 1.9-1.9h4.3" />
    </Icon>
  );
}

/** Close, dismiss, remove. */
export function IconX(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6.2 6.2 11.6 11.6M17.8 6.2 6.2 17.8" />
    </Icon>
  );
}

/** Chevron, pointing right. Rotate with CSS for the other three directions. */
export function IconChevron(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9.2 5.4 6.8 6.6-6.8 6.6" />
    </Icon>
  );
}

/** Ink sparkle — a suggestion, something PI came up with. */
export function IconSpark(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.4 3c.55 4 2.05 5.5 6.05 6.05-4 .55-5.5 2.05-6.05 6.05-.55-4-2.05-5.5-6.05-6.05C8.35 8.5 9.85 7 10.4 3Z" />
      <path d="M17.6 14.2c.24 1.85.94 2.55 2.8 2.8-1.86.25-2.56.95-2.8 2.8-.25-1.85-.95-2.55-2.8-2.8 1.85-.25 2.55-.95 2.8-2.8Z" />
    </Icon>
  );
}

/** Wall calendar — agenda, dates. */
export function IconCalendar(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="5.6" width="17" height="14.9" rx="2.2" />
      <path d="M3.5 10.2h17M8.2 3.5v4.2M15.8 3.5v4.2" />
    </Icon>
  );
}

/** Branch — fork this conversation from here. */
export function IconFork(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6.6" cy="5.9" r="2.3" />
      <circle cx="17.4" cy="5.9" r="2.3" />
      <circle cx="12" cy="18.1" r="2.3" />
      <path d="M6.6 8.2v1.9a2.6 2.6 0 0 0 2.6 2.6h5.6a2.6 2.6 0 0 0 2.6-2.6V8.2" />
      <path d="M12 12.7v3.1" />
    </Icon>
  );
}

/** Two sheets, the back one set down askew — copy. */
export function IconCopy(props: IconProps) {
  return (
    <Icon {...props}>
      <rect
        x="10"
        y="3.4"
        width="10.6"
        height="10.6"
        rx="2"
        transform="rotate(6 15.3 8.7)"
      />
      <rect x="3.6" y="9.6" width="11" height="11" rx="2" />
    </Icon>
  );
}

/** Rewind — take the conversation back to this turn. */
export function IconRewind(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.6 11.4a7.7 7.7 0 1 1 2.3 6.1" />
      <path d="M4.4 6.2v5.2h5.2" />
    </Icon>
  );
}

/** Retry — run that turn again. */
export function IconRetry(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19.4 11.4a7.7 7.7 0 1 0-2.3 6.1" />
      <path d="M19.6 6.2v5.2h-5.2" />
    </Icon>
  );
}

/** Where this came from, why PI needs it. */
export function IconInfo(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 11.2v5.4" />
      <circle cx="12" cy="7.9" r="1.05" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Three ruled lines — open the sidebar. */
export function IconMenu(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.4 7.2h15.2M4.4 12h11.4M4.4 16.8h15.2" />
    </Icon>
  );
}

/** Folded paper plane — send. */
export function IconSend(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20.6 4 3.9 10.7a.55.55 0 0 0 .06 1.04l6.5 1.86 1.86 6.5a.55.55 0 0 0 1.04.06L20.6 4Z" />
      <path d="M20.6 4 10.46 13.6" />
    </Icon>
  );
}

/**
 * The π mark, written rather than typeset. Used in the sidebar wordmark, the
 * sign-in card and the boot shell so the brand glyph never depends on Georgia
 * being installed. Sits inside `.pi-lozenge`.
 */
export function PiMark({ size = 16, title, ...rest }: IconProps) {
  return (
    <svg
      className="icon pi-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d="M4.6 7.4h14.8" />
      <path d="M9.4 7.4v8c0 1.9-.9 3-2.7 3.4" />
      <path d="M15.2 7.4v8.3c0 1.6.9 2.5 2.6 2.7" />
    </svg>
  );
}
