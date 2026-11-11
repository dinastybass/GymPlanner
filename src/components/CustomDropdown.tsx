import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search } from 'lucide-react';

export interface DropdownOption {
  value: string;
  label: string;
  search?: string;
  sublabel?: string;
}

interface CustomDropdownProps {
  options: DropdownOption[];
  value: string | string[];
  onChange: (val: any) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  isMulti?: boolean;
  disabled?: boolean;
  className?: string;
}

export const CustomDropdown: React.FC<CustomDropdownProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Selecciona una opción...',
  searchPlaceholder = 'Buscar...',
  isMulti = false,
  disabled = false,
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearchTerm('');
    }
  }, [isOpen]);

  useEffect(() => {
    setSearchTerm('');
  }, [value]);

  const normalize = (txt: string) =>
    String(txt || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const filteredOptions = options.filter(opt => {
    const sTerm = normalize(searchTerm);
    if (!sTerm) return true;
    const target = normalize(`${opt.label} ${opt.search || ''} ${opt.sublabel || ''}`);
    return target.includes(sTerm);
  });

  const getDisplayText = () => {
    if (isMulti) {
      const arr = Array.isArray(value) ? value : [];
      if (arr.length === 0) return placeholder;
      if (arr.length === 1) {
        const found = options.find(o => o.value === arr[0]);
        return found ? found.label : arr[0];
      }
      return `${arr.length} seleccionado(s)`;
    } else {
      if (!value) return placeholder;
      const found = options.find(o => o.value === value);
      return found ? found.label : String(value);
    }
  };

  const handleSelect = (optValue: string) => {
    if (isMulti) {
      const arr = Array.isArray(value) ? [...value] : [];
      const idx = arr.indexOf(optValue);
      if (idx >= 0) {
        arr.splice(idx, 1);
      } else {
        arr.push(optValue);
      }
      onChange(arr);
    } else {
      onChange(optValue);
      setIsOpen(false);
    }
  };

  return (
    <div
      ref={wrapperRef}
      className={`custom-dropdown ${className}`}
      style={{ position: 'relative', width: '100%' }}
    >
      <div
        className={`dropdown-trigger ${disabled ? 'disabled' : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        style={{
          border: '1px solid #d1d5db',
          borderRadius: '6px',
          padding: '10px 14px',
          background: disabled ? '#f8fafc' : '#ffffff',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          fontSize: '0.95rem'
        }}
      >
        <span style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: (isMulti ? (Array.isArray(value) && value.length > 0) : value) ? '#111827' : '#9ca3af'
        }}>
          {getDisplayText()}
        </span>
        <ChevronDown size={16} style={{ color: '#64748b', transform: isOpen ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
      </div>

      {isOpen && (
        <div
          className="dropdown-panel active"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
            zIndex: 1000,
            maxHeight: '260px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          <div style={{ padding: '8px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Search size={15} style={{ color: '#94a3b8' }} />
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={searchPlaceholder}
              style={{
                width: '100%',
                border: 'none',
                outline: 'none',
                fontSize: '0.9rem',
                padding: '4px'
              }}
            />
          </div>

          <div style={{ overflowY: 'auto', flexGrow: 1 }}>
            {filteredOptions.length === 0 ? (
              <div style={{ padding: '12px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                Sin resultados
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = isMulti
                  ? Array.isArray(value) && value.includes(opt.value)
                  : value === opt.value;

                return (
                  <div
                    key={opt.value}
                    onClick={() => handleSelect(opt.value)}
                    style={{
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      background: isSelected ? '#f0fdfa' : 'transparent',
                      color: isSelected ? '#0d7488' : '#1e293b',
                      fontSize: '0.9rem',
                      fontWeight: isSelected ? 600 : 400,
                      borderBottom: '1px solid #f8fafc'
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = '#f8fafc';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    {isMulti && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        style={{ width: 'auto', margin: 0, cursor: 'pointer' }}
                      />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                      <span>{opt.label}</span>
                      {opt.sublabel && (
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{opt.sublabel}</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
