import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { ToastModule } from 'primeng/toast';
import { Chat } from './chat';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ToastModule, Chat],
  template: `
    <p-toast position="top-right" />
    <header>
      <img src="korp.png" alt="KORP ERP" class="logo" />
      <h1>Notas Fiscais</h1>
      <nav>
        <a routerLink="/produtos" routerLinkActive="ativo"><i class="pi pi-box"></i> Produtos</a>
        <a routerLink="/notas" routerLinkActive="ativo"><i class="pi pi-file"></i> Notas fiscais</a>
      </nav>
    </header>
    <main><router-outlet /></main>
    <app-chat />
  `,
  styleUrl: './app.css',
})
export class App {}
