using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Vistoria.Api.Tests.Support;

/// <summary>Conta os comandos SQL que o EF cria, para um teste provar que uma leitura não faz N+1.</summary>
public sealed class CommandCounter : DbCommandInterceptor
{
    private int _count;

    public int Count => Volatile.Read(ref _count);

    public void Reset() => Interlocked.Exchange(ref _count, 0);

    public override DbCommand CommandCreated(CommandEndEventData eventData, DbCommand result)
    {
        Interlocked.Increment(ref _count);
        return result;
    }
}
