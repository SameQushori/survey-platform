import React from 'react';

/**
 * React компонент для отображения обрезанного текста с тултипом
 * @param {string} text - исходный текст
 * @param {number} maxLength - максимальная длина
 * @param {string} className - CSS класс
 * @returns {JSX.Element} - элемент с тултипом
 */
const TruncatedText = ({ text, maxLength = 50, className = '' }) => {
  if (!text || typeof text !== 'string') return <span className={className}></span>;
  
  const isTruncated = text.length > maxLength;
  const displayText = isTruncated ? text.substring(0, maxLength) + '...' : text;
  
  return (
    <span 
      className={className}
      title={isTruncated ? text : undefined}
      style={{ 
        cursor: isTruncated ? 'help' : 'default',
        display: 'inline-block',
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}
    >
      {displayText}
    </span>
  );
};

export default TruncatedText; 