import {
  useEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { makeDraggable } from "../lib/makeDraggable";

type CommonProps = {
  children?: ReactNode;
  /** Drag the outer element via a child handle (e.g. `.win-chrome`). */
  handleSelector?: string;
  className?: string;
  style?: CSSProperties;
};

type DraggableDivProps = CommonProps &
  Omit<HTMLAttributes<HTMLDivElement>, "className" | "style" | "children"> & {
    as?: "div";
  };

type DraggableImgProps = CommonProps &
  React.ImgHTMLAttributes<HTMLImageElement> & {
    as: "img";
  };

type DraggableVideoProps = CommonProps &
  React.VideoHTMLAttributes<HTMLVideoElement> & {
    as: "video";
  };

type DraggableButtonProps = CommonProps &
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    as: "button";
  };

export type DraggableProps =
  | DraggableDivProps
  | DraggableImgProps
  | DraggableVideoProps
  | DraggableButtonProps;

export function Draggable(props: DraggableProps) {
  const { as = "div", children, handleSelector, className, style, ...rest } =
    props;
  const ref = useRef<HTMLElement | null>(null);
  const mergedClass = ["draggable", className].filter(Boolean).join(" ");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handle =
      (handleSelector
        ? el.querySelector<HTMLElement>(handleSelector)
        : null) ?? el;
    return makeDraggable(el, handle);
  }, [handleSelector]);

  if (as === "img") {
    return (
      <img
        {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)}
        alt={(rest as React.ImgHTMLAttributes<HTMLImageElement>).alt ?? ""}
        ref={ref as React.RefObject<HTMLImageElement>}
        className={mergedClass}
        style={style}
        draggable={false}
      />
    );
  }

  if (as === "video") {
    return (
      <video
        {...(rest as React.VideoHTMLAttributes<HTMLVideoElement>)}
        ref={ref as React.RefObject<HTMLVideoElement>}
        className={mergedClass}
        style={style}
        draggable={false}
      />
    );
  }

  if (as === "button") {
    return (
      <button
        {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        ref={ref as React.RefObject<HTMLButtonElement>}
        className={mergedClass}
        style={style}
      >
        {children}
      </button>
    );
  }

  return (
    <div
      {...(rest as HTMLAttributes<HTMLDivElement>)}
      ref={ref as React.RefObject<HTMLDivElement>}
      className={mergedClass}
      style={style}
    >
      {children}
    </div>
  );
}
