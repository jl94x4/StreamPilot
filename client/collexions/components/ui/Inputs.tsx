import React from 'react';
import { HelpCircle } from 'lucide-react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  helperText?: string;
  tooltip?: string;
}

export const Input: React.FC<InputProps> = ({ label, helperText, tooltip, className = '', ...props }) => (
  <div className="space-y-1.5">
    <div className="flex items-center gap-1.5">
      <label className="block text-sm font-medium text-text">
        {label}
      </label>
      {tooltip && (
        <div className="relative leading-none">
          <HelpCircle className="peer w-3.5 h-3.5 text-muted hover:text-plex cursor-help transition-colors" />
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-card border border-border rounded-lg text-[10px] text-muted opacity-0 peer-hover:opacity-100 transition-all duration-200 pointer-events-none z-[100] shadow-2xl font-normal leading-normal">
            {tooltip}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-card" />
          </div>
        </div>
      )}
    </div>
    <input
      className={`w-full appearance-none bg-background border border-border rounded-lg px-3 py-2 text-[16px] leading-5 text-text focus:outline-none focus:ring-1 focus:ring-plex focus:border-plex transition-all placeholder:text-muted ${className}`}
      {...props}
    />
    {helperText && <p className="text-xs text-muted">{helperText}</p>}
  </div>
);

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: { value: string | number; label: string }[];
}

export const Select: React.FC<SelectProps> = ({ label, options, className = '', ...props }) => (
  <div className="space-y-1.5">
    <label className="block text-sm font-medium text-text">
      {label}
    </label>
    <select
      className={`w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:outline-none focus:ring-1 focus:ring-plex focus:border-plex transition-all cursor-pointer ${className}`}
      {...props}
    >
      {options.map(opt => (
        <option key={opt.value} value={opt.value} className="bg-card text-text">{opt.label}</option>
      ))}
    </select>
  </div>
);

interface CustomSelectProps {
  label: string;
  value: string | number;
  options: { value: string | number; label: string }[];
  onChange: (value: any) => void;
  className?: string;
  placeholder?: string;
  tooltip?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({ label, value, options, onChange, className = '', placeholder = 'Select...', tooltip }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`space-y-1.5 relative ${className}`} ref={containerRef}>
      {label && (
        <div className="flex items-center gap-1.5">
          <label className="block text-sm font-medium text-text">
            {label}
          </label>
          {tooltip && (
            <div className="relative leading-none">
              <HelpCircle className="peer w-3.5 h-3.5 text-muted hover:text-plex cursor-help transition-colors" />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-card border border-border rounded-lg text-[10px] text-muted opacity-0 peer-hover:opacity-100 transition-all duration-200 pointer-events-none z-[100] shadow-2xl font-normal leading-normal">
                {tooltip}
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-card" />
              </div>
            </div>
          )}
        </div>
      )}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full bg-background border ${isOpen ? 'border-plex ring-1 ring-plex' : 'border-border'} rounded-lg px-3 py-2 text-text flex items-center justify-between cursor-pointer transition-all hover:bg-white/5`}
      >
        <span className={!selectedOption ? 'text-muted' : ''}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <svg
          className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180 text-plex' : 'text-muted'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {isOpen && (
        <div className="absolute z-[100] mt-1 w-full bg-card border border-border rounded-xl shadow-2xl overflow-hidden animate-fade-in">
          <div className="max-h-60 overflow-y-auto custom-scrollbar">
            {options.map((opt) => (
              <div
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`px-4 py-2.5 text-sm cursor-pointer transition-colors flex items-center justify-between ${value === opt.value ? 'bg-plex/20 text-plex font-bold' : 'text-muted hover:bg-white/5 hover:text-text'
                  }`}
              >
                <span>{opt.label}</span>
                {value === opt.value && (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};


interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  tooltip?: string;
}

export const Switch: React.FC<SwitchProps> = ({ label, checked, onChange, description, tooltip }) => (
  <div className="flex items-center justify-between py-2 gap-4">
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 flex-wrap">
        <label className="text-sm font-medium text-text block">{label}</label>
        {tooltip && (
          <div className="relative leading-none">
            <HelpCircle className="peer w-3.5 h-3.5 text-muted hover:text-plex cursor-help transition-colors" />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-card border border-border rounded-lg text-[10px] text-muted opacity-0 peer-hover:opacity-100 transition-all duration-200 pointer-events-none z-[100] shadow-2xl font-normal leading-normal">
              {tooltip}
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-card" />
            </div>
          </div>
        )}
      </div>
      {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-plex/50 focus:ring-offset-2 focus:ring-offset-background ${checked ? 'bg-plex' : 'bg-white/15'
        }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'
          }`}
      />
    </button>
  </div>
);
