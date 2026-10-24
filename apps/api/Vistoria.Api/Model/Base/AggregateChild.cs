namespace Vistoria.Api.Model.Base;

/// <summary>
/// Base dos filhos do agregado da vistoria (<see cref="Room"/> e <see cref="InspectionItem"/>), ADR 0035. Sem versão,
/// dono nem datas próprias: tudo isso é da raiz, e mudar um filho sobe a versão dela (<c>AppDbContext</c>).
/// </summary>
public abstract class AggregateChild
{
    public Guid Id { get; set; }                   // gerado no cliente (UUID v7)
    public DateTimeOffset? DeletedAt { get; set; } // soft delete: omitido no PUT da raiz
}
