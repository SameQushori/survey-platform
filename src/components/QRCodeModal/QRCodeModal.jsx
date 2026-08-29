import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import './QRCodeModal.css';

const QRCodeModal = ({ isOpen, onClose, surveyCode, surveyTitle }) => {
  if (!isOpen) return null;

  const surveyUrl = `${window.location.origin}/participant?code=${surveyCode}`;

  const handleDownloadQR = () => {
    const canvas = document.createElement('canvas');
    const svg = document.querySelector('.qr-code svg');
    const svgData = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    
    img.onload = () => {
      canvas.width = 300;
      canvas.height = 350;
      const ctx = canvas.getContext('2d');
      
      // Белый фон
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // QR код
      ctx.drawImage(img, 50, 50, 200, 200);
      
      // Текст
      ctx.fillStyle = '#333';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Код опроса:', canvas.width / 2, 280);
      ctx.fillText(surveyCode, canvas.width / 2, 300);
      
      // Скачивание
      const link = document.createElement('a');
      link.download = `qr-code-${surveyCode}.png`;
      link.href = canvas.toDataURL();
      link.click();
    };
    
    img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(surveyUrl);
    // Можно добавить уведомление об успешном копировании
  };

  return (
    <div className="qr-modal-overlay">
      <div className="qr-modal">
        <button className="qr-modal-close" onClick={onClose}>
          ×
        </button>
        
        <div className="qr-modal-content">
          <div className="qr-modal-header">
            <h2>QR-код опроса</h2>
            <p className="survey-title">{surveyTitle}</p>
          </div>
          
          <div className="qr-code-container">
            <div className="qr-code">
              <QRCodeSVG
                value={surveyUrl}
                size={200}
                level="M"
                includeMargin={true}
                bgColor="#FFFFFF"
                fgColor="#000000"
              />
            </div>
            
            <div className="qr-info">
              <div className="code-display">
                <span className="code-label">Код опроса:</span>
                <span className="code-value">{surveyCode}</span>
              </div>
              
              <div className="url-display">
                <span className="url-label">Ссылка:</span>
                <span className="url-value">{surveyUrl}</span>
              </div>
            </div>
          </div>
          
          <div className="qr-actions">
            <button 
              className="btn btn-primary"
              onClick={handleCopyLink}
            >
              📋 Копировать ссылку
            </button>
            <button 
              className="btn btn-secondary"
              onClick={handleDownloadQR}
            >
              📥 Скачать QR-код
            </button>
          </div>
          
          <div className="qr-instructions">
            <h4>Как использовать:</h4>
            <ul>
              <li>Участники могут отсканировать QR-код камерой телефона</li>
              <li>Или ввести код вручную на главной странице</li>
              <li>QR-код содержит прямую ссылку на опрос</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QRCodeModal; 