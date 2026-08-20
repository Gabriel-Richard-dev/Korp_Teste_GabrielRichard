import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: 'produtos', loadComponent: () => import('./produtos').then((m) => m.Produtos) },
  { path: 'notas', loadComponent: () => import('./notas').then((m) => m.Notas) },
  { path: '**', redirectTo: 'produtos' },
];
