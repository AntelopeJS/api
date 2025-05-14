import { Controller, Get, Post, Put, Delete, JSONBody, Parameter, assert } from '@ajs/api/beta';

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
  async update(@JSONBody() body: unknown) {
    console.log('update', body);
    return { updated: body };
  }

  @Delete('/remove')
  async remove() {
    console.log('remove');
    return { message: 'Deleted' };
  }

  @Get('/ping')
  async ping(@Parameter('pong', 'query') pong: string) {
    assert(pong === 'pong', 400, 'Pong must be pong');

    return { message: 'Pong', pong };
  }
}

export function construct(): void {}

export function destroy(): void {}

export async function start(): Promise<void> {}

export function stop(): void {}
