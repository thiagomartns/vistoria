namespace Vistoria.Api.Model.Base;

/// <summary>
/// Base de toda entidade do domínio: o que o sync precisa (backend.md, "Entidade sincronizável"). A configuração
/// do EF e o carimbo das datas ficam no <c>AppDbContext</c>, para valer em todo derivado sem repetir.
/// </summary>
public abstract class SyncEntity
{
    public Guid Id { get; set; }                   // gerado no cliente (UUID v7)
    public byte[] Version { get; set; } = [];      // rowversion do SQL Server
    public DateTimeOffset CreatedAt { get; set; }  // do TimeProvider no SaveChanges, nunca do cliente
    public DateTimeOffset UpdatedAt { get; set; }  // idem
    public DateTimeOffset? DeletedAt { get; set; } // soft delete
    public Guid OwnerId { get; set; }              // escopo de quem vê
}
