import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconFrame({ children, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      {children}
    </svg>
  );
}

export function ShieldCheckIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M12 3 5 6v5.4c0 4.3 2.8 7.8 7 9.6 4.2-1.8 7-5.3 7-9.6V6l-7-3Z" /><path d="m9.2 12 1.8 1.8 3.9-4" /></IconFrame>;
}

export function CalendarIcon(props: IconProps) {
  return <IconFrame {...props}><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M8 3v4M16 3v4M3.5 10h17" /></IconFrame>;
}

export function CheckIcon(props: IconProps) {
  return <IconFrame {...props}><path d="m5 12.5 4.2 4.2L19 7" /></IconFrame>;
}

export function PhoneIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M7.2 3.8 10 8.1 7.8 10c1.2 2.6 3.3 4.7 5.9 5.9l1.9-2.2 4.3 2.8-.5 3c-.2 1-1.1 1.7-2.1 1.6C9.8 20.3 3.7 14.2 2.9 6.7c-.1-1 .6-1.9 1.6-2.1l2.7-.8Z" /></IconFrame>;
}

export function ClipboardIcon(props: IconProps) {
  return <IconFrame {...props}><rect x="5" y="4.5" width="14" height="16" rx="2" /><path d="M9 4.5V3h6v1.5M8.5 10h7M8.5 14h7" /></IconFrame>;
}

export function AlertIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M10.4 4.2 2.8 18a2 2 0 0 0 1.8 3h14.8a2 2 0 0 0 1.8-3L13.6 4.2a1.8 1.8 0 0 0-3.2 0Z" /><path d="M12 9v4.5M12 17.3v.1" /></IconFrame>;
}

export function BoxIcon(props: IconProps) {
  return <IconFrame {...props}><path d="m4 7 8-4 8 4-8 4-8-4Z" /><path d="M4 7v10l8 4 8-4V7M12 11v10" /></IconFrame>;
}
