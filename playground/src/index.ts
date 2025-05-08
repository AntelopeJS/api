import { Controller, Get, Post, Put, Delete } from '@ajs/api/beta';

export class PlaygroundController extends Controller('/playground') {
  @Get('/hello')
  async hello() {
    return { message: 'Hello World' };
  }

  @Post('/echo')
  async echo(body: any) {
    console.log('echo', body);
    return { received: body };
  }

  @Put('/update')
  async update(body: any) {
    console.log('update', body);
    return { updated: body };
  }

  @Delete('/remove')
  async remove() {
    console.log('remove');
    return { message: 'Deleted' };
  }
}

export function construct(): void {}

export function destroy(): void {}

export async function start(): Promise<void> {}

export function stop(): void {}
