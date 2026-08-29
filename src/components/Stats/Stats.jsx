import React from 'react';
import './Stats.css';

const Stats = () => {
  const stats = [
    { number: '1000+', label: 'Организаторов' },
    { number: '50,000+', label: 'Участников' },
    { number: '25,000+', label: 'Опросов' },
    { number: '98%', label: 'Довольных клиентов' }
  ];

  return (
    <section className="stats">
      <div className="stats-content">
        <h2 className="section-title">Платформе доверяют</h2>
        <div className="stats-grid">
          {stats.map((stat, index) => (
            <div key={index} className="stat">
              <div className="stat-number">{stat.number}</div>
              <div className="stat-label">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Stats; 