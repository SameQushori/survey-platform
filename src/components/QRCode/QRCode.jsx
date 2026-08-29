import React from 'react';
import './QRCode.css';

const QRCode = ({ surveyId, onClose }) => {
  // В реальном приложении здесь будет генерация QR-кода
  const qrCodeUrl = `https://surveypro.com/join/${surveyId}`;
  
  return (
    <div className="qr-modal">
      <div className="qr-content" onClick={e => e.stopPropagation()}>
        <div className="qr-header">
          <span className="close" onClick={onClose}>&times;</span>
          <h2>QR-код для опроса</h2>
        </div>
        <div className="qr-body">
          <div className="qr-code-placeholder">
            <div className="qr-code">
              <div className="qr-pattern">
                <div className="qr-corner top-left"></div>
                <div className="qr-corner top-right"></div>
                <div className="qr-corner bottom-left"></div>
                <div className="qr-dots">
                  {Array.from({ length: 25 }, (_, i) => (
                    <div key={i} className="qr-dot"></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <p className="qr-instructions">
            Отсканируйте этот QR-код, чтобы присоединиться к опросу
          </p>
          <div className="qr-link">
            <span>Ссылка: </span>
            <a href={qrCodeUrl} target="_blank" rel="noopener noreferrer">
              {qrCodeUrl}
            </a>
          </div>
          <button className="btn btn-primary" onClick={() => navigator.clipboard.writeText(qrCodeUrl)}>
            Скопировать ссылку
          </button>
        </div>
      </div>
    </div>
  );
};

export default QRCode; 