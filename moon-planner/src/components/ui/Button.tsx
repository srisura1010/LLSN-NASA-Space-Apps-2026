import type { ButtonHTMLAttributes } from "react";
import { buttonClass, toggleClass } from "./styles";

type Variant = keyof typeof buttonClass;

/** The bulletin's buttons: primary (ink), secondary (outlined) and link. Square, 32 px tall. */
export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={`${buttonClass[variant]} ${className}`} {...rest} />;
}

/** A button that stays pressed (aria-pressed): ink when on, or a soft grey for a layer that is shown by default. */
export function ToggleButton({
  on,
  size = "md",
  soft = false,
  className = "",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { on: boolean; size?: "sm" | "md"; soft?: boolean }) {
  return <button type="button" aria-pressed={on} className={`${toggleClass(on, size, soft)} ${className}`} {...rest} />;
}
