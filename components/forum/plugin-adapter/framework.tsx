import {
  lazy,
  Suspense,
  type ComponentType,
  type ImgHTMLAttributes,
} from "react";
// The sandbox loads ordinary authenticated storage URLs; Next's image optimization server is unavailable here.
/* eslint-disable @next/next/no-img-element */
export function Image({
  unoptimized: _unoptimized,
  priority: _priority,
  fill: _fill,
  quality: _quality,
  loader: _loader,
  placeholder: _placeholder,
  blurDataURL: _blur,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & {
  unoptimized?: boolean;
  priority?: boolean;
  fill?: boolean;
  quality?: number;
  loader?: unknown;
  placeholder?: unknown;
  blurDataURL?: string;
}) {
  return <img {...props} alt={props.alt ?? ""} />;
}
export default function dynamic<P extends object>(
  loader: () => Promise<ComponentType<P> | { default: ComponentType<P> }>,
  options?: { ssr?: boolean; loading?: ComponentType },
) {
  const Component = lazy(async () => {
    const loaded = await loader();
    return { default: "default" in loaded ? loaded.default : loaded };
  });
  return function Dynamic(props: P) {
    const Loading = options?.loading;
    return (
      <Suspense fallback={Loading ? <Loading /> : null}>
        <Component {...props} />
      </Suspense>
    );
  };
}
export function useAuthToken() {
  return null;
}
export function useAuthActions() {
  return {
    signIn: async () => {
      throw new Error("Connect SYMBaiEX Forum in your ChatGPT settings.");
    },
    signOut: async () => {
      throw new Error("Disconnect this plugin in your ChatGPT settings.");
    },
  };
}
export function usePresence() {
  return undefined;
}
export function StructuredData() {
  return null;
}
export function WebVitalsReporter() {
  return null;
}
export function AnalyticsTracker() {
  return null;
}
export function useReportWebVitals() {
  return undefined;
}
export function headers() {
  return new Headers();
}
