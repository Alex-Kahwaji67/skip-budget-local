import { useEffect, useRef, useId, type ReactNode } from "react";
import {
  MADRID_TIMEZONE,
  type AppState,
  type Session,
  type CourseProjection,
  type AttendanceStatus,
} from "./domain";
export type IconName =
  | "alert"
  | "arrow-left"
  | "arrow-right"
  | "calendar"
  | "check"
  | "close"
  | "download"
  | "edit"
  | "file"
  | "face-frown"
  | "face-neutral"
  | "face-smile"
  | "plus"
  | "restore"
  | "trash"
  | "upload"
  | "plane"
  | "book"
  | "bag"
  | "info"
  | "flask"
  | "data"
  | "home"
  | "list"
  | "filter";

export const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
export const unitIds = (session: Session) =>
  session.units.map((unit) => unit.id);

const parts = (epoch: number) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: MADRID_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(epoch))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

export const dateKey = (epoch: number) => {
  const value = parts(epoch);
  return `${value.year}-${value.month}-${value.day}`;
};
export const inputDateTime = (epoch?: number) => {
  if (epoch === undefined) return "";
  const value = parts(epoch);
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
};
export const formatDate = (
  epoch: number,
  options: Intl.DateTimeFormatOptions = {},
) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: MADRID_TIMEZONE,
    day: "numeric",
    month: "short",
    ...options,
  }).format(epoch);
export const formatTime = (epoch: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: MADRID_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(epoch);
export const formatDateTime = (epoch: number) =>
  `${formatDate(epoch, { weekday: "short" })} · ${formatTime(epoch)}`;
export const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
export const mondayOf = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  return addDays(value, -((date.getUTCDay() + 6) % 7));
};
export const todayInMadrid = () => dateKey(Date.now());
export const courseName = (state: AppState, id: string) =>
  state.courses.find((course) => course.id === id)?.name ?? "Unknown course";
export const sessionsByDate = (sessions: Session[]) => {
  const groups = new Map<string, Session[]>();
  for (const session of [...sessions].sort((a, b) => a.startsAt - b.startsAt)) {
    const day = dateKey(session.startsAt);
    groups.set(day, [...(groups.get(day) ?? []), session]);
  }
  return groups;
};

export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    plane: (
      <>
        <path d="m21 3-6 18-4-8-8-4 18-6ZM11 13l5-5M5 16l3 3" />
      </>
    ),
    book: (
      <>
        <path d="m2 8 10-5 10 5-10 5L2 8ZM6 10v7l6 4 6-4v-7M22 8v9" />
      </>
    ),
    bag: (
      <>
        <rect x="3" y="7" width="18" height="14" rx="2" />
        <path d="M8 7V3h8v4M8 7v14M16 7v14" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7h.01" />
      </>
    ),
    flask: (
      <>
        <path d="M9 3h6M10 3v6L4 20h16L14 9V3M8 15h8" />
      </>
    ),
    data: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" />
      </>
    ),
    home: (
      <>
        <path d="m3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10" />
      </>
    ),
    list: (
      <>
        <path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01" />
      </>
    ),
    filter: (
      <>
        <path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z" />
      </>
    ),
    alert: (
      <>
        <path d="M12 3 2.8 20h18.4L12 3Z" />
        <path d="M12 9v4.5" />
        <path d="M12 17h.01" />
      </>
    ),
    "arrow-left": (
      <>
        <path d="m15 18-6-6 6-6" />
      </>
    ),
    "arrow-right": (
      <>
        <path d="m9 18 6-6-6-6" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    close: (
      <>
        <path d="m6 6 12 12M18 6 6 18" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />
      </>
    ),
    edit: (
      <>
        <path d="m4 20 4.2-1 10-10-3.2-3.2-10 10L4 20Z" />
        <path d="m13.8 7 3.2 3.2" />
      </>
    ),
    file: (
      <>
        <path d="M6 3h8l4 4v14H6V3Z" />
        <path d="M14 3v5h5M9 13h6M9 17h6" />
      </>
    ),
    "face-frown": (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9h.01M15 9h.01M8 17c1-2 2.3-3 4-3s3 1 4 3" />
      </>
    ),
    "face-neutral": (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9h.01M15 9h.01M8 15h8" />
      </>
    ),
    "face-smile": (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9h.01M15 9h.01M8 14c1 2 2.3 3 4 3s3-1 4-3" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    restore: (
      <>
        <path d="M4 4v6h6" />
        <path d="M5.5 9A8 8 0 1 1 6 17" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4m0 0-4 4m4-4 4 4M4 20h16" />
      </>
    ),
  };
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false,
  dismissible = true,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const programmaticClose = useRef(false);
  const titleId = useId();
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const previouslyFocused = document.activeElement;
    if (open && !node.open) node.showModal();
    if (!open && node.open) {
      programmaticClose.current = true;
      node.close();
    }
    return () => {
      if (
        open &&
        previouslyFocused instanceof HTMLElement &&
        previouslyFocused.isConnected
      )
        previouslyFocused.focus();
    };
  }, [open]);
  return (
    <dialog
      className={wide ? "wide-dialog" : ""}
      aria-labelledby={titleId}
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onClose={() => {
        if (programmaticClose.current) {
          programmaticClose.current = false;
          return;
        }
        onClose();
      }}
    >
      <div className="dialog-shell">
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          {dismissible && (
            <button
              className="icon-button"
              type="button"
              onClick={onClose}
              aria-label="Close"
            >
              <Icon name="close" />
            </button>
          )}
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-foot">{footer}</div> : null}
      </div>
    </dialog>
  );
}

export function StatusBadge({ projection }: { projection: CourseProjection }) {
  const tone =
    projection.status === "Within budget"
      ? ""
      : projection.status === "At limit"
        ? "warning"
        : "danger";
  return <span className={`status ${tone}`}>{projection.status}</span>;
}

export function AttendancePicker({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: AttendanceStatus | "";
  onChange: (value: AttendanceStatus | "") => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select
      className="attendance-select"
      disabled={disabled}
      aria-label={label}
      value={value}
      onChange={(event) =>
        onChange(event.target.value as AttendanceStatus | "")
      }
    >
      <option value="">Unknown</option>
      <option value="attended">Attended</option>
      <option value="absent">Absent</option>
      <option value="excused">Excused</option>
    </select>
  );
}
