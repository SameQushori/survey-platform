import React from 'react';
import './CTA.css';

const CTA = ({ onOpenModal }) => {
  return (
    <section className="cta">
      <div className="cta-content">
        <h2>Готовы начать?</h2>
        <p>Создайте свой первый опрос прямо сейчас и получите мгновенные результаты</p>
        <a href="#" className="btn-hero btn-hero-primary" onClick={onOpenModal}>
          Создать опрос бесплатно
        </a>
      </div>
    </section>
  );
};

export default CTA; 