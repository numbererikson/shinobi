import { clsx } from 'clsx';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClass: Record<ButtonVariant, string> = {
  default: 'bg-border-2 border-border text-text hover:bg-border',
  primary: 'bg-accent-2 border-accent-2 text-white hover:bg-accent-3',
  ghost: 'bg-transparent border-transparent text-text-muted hover:text-text hover:bg-panel',
  danger: 'bg-danger border-danger text-white hover:opacity-90',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'text-xs px-2 py-1',
  md: 'text-sm px-3 py-1.5',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', size = 'md', className, ...rest }, ref) => (
    <button
      ref={ref}
      className={clsx(
        'border rounded transition-colors font-medium cursor-pointer disabled:opacity-50 disabled:cursor-wait',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    />
  ),
);

Button.displayName = 'Button';
