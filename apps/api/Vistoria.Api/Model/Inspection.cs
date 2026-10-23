using Vistoria.Api.Model.Base;

namespace Vistoria.Api.Model;

/// <summary>
/// Raiz do agregado da vistoria (vision.md, "Inspection (raiz)"). Ambientes e itens só são escritos por ela, e a versão
/// dela é a do agregado inteiro (backend.md, "Regra do agregado").
/// </summary>
public class Inspection : SyncEntity
{
    public Guid PropertyId { get; set; }
    public InspectionKind Kind { get; set; }
    public InspectionStatus Status { get; set; }
    public Guid? ReferenceInspectionId { get; set; } // só em saída: a entrada concluída do mesmo imóvel
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; } // do servidor, ao concluir
    public string? GeneralNotes { get; set; }
    public List<Room> Rooms { get; set; } = [];
}
